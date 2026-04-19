import base64
import json
import os
import re

import boto3
from botocore.exceptions import ClientError, WaiterError

from bedrock_client import invoke_bedrock
from session_store import (
    build_assistant_message_content,
    ensure_session_external_id,
    generate_session_id,
    get_session_external_id,
    get_latest_assistant_architecture_context,
    get_recent_chat_messages,
    save_message,
)
from validation import validate_mermaid_syntax

# Caches for prompts to minimize S3 calls during warm starts
PROMPT_CACHE = {
    "system-prompt": None,
    "cfn-prompt": None
}

PROMPT_BUCKET_ENV = "PROMPTS_BUCKET"
PROMPT_PREFIX_ENV = "PROMPTS_PREFIX"


def _read_local_prompt(prompt_type: str) -> str:
    local_path = os.path.join(os.path.dirname(__file__), f"{prompt_type}.txt")
    with open(local_path, "r", encoding="utf-8") as prompt_file:
        return prompt_file.read()

def get_system_prompt(prompt_type="system-prompt"):
    """Fetch prompt from S3 or use local fallback, with warm-cache."""
    if PROMPT_CACHE[prompt_type] is not None:
        return PROMPT_CACHE[prompt_type]

    s3 = boto3.client("s3")
    bucket = os.getenv(PROMPT_BUCKET_ENV, "cloudweaver-prompts-private")
    prefix = os.getenv(PROMPT_PREFIX_ENV, "prompts/")
    normalized_prefix = prefix if prefix.endswith("/") else f"{prefix}/"
    key = f"{normalized_prefix}{prompt_type}.txt"

    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        prompt = response['Body'].read().decode('utf-8')
        PROMPT_CACHE[prompt_type] = prompt
        return prompt
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in {"NoSuchKey", "NoSuchBucket", "AccessDenied"}:
            print(
                f"S3 prompt fetch failed for s3://{bucket}/{key} ({error_code}); "
                "falling back to bundled local prompt file."
            )
            prompt = _read_local_prompt(prompt_type)
            PROMPT_CACHE[prompt_type] = prompt
            return prompt
        raise
    except Exception as e:
        print(f"Unexpected prompt fetch failure for s3://{bucket}/{key}: {e}")
        prompt = _read_local_prompt(prompt_type)
        PROMPT_CACHE[prompt_type] = prompt
        return prompt

SERVICE_MATCHERS = {
    "Amazon Bedrock": ["bedrock"],
    "AWS Lambda": ["lambda"],
    "Amazon S3": ["s3", "bucket", "simple storage"],
    "API Gateway": ["api gateway", "apigateway", "apigw", "gateway"],
    "CloudFront": ["cloudfront"],
    "CloudFormation": ["cloudformation", "cfn"],
    "DynamoDB": ["dynamodb", "ddb"],
    "AWS IAM": ["iam", "identity center", "sts", "identity and access management"],
}

ALLOWED_SERVICE_SET = set(SERVICE_MATCHERS.keys())
IAM_ROLE_ARN_PATTERN = re.compile(r"^arn:aws(-[a-z]+)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$")
STACK_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,127}$")
REGION_PATTERN = re.compile(r"^[a-z]{2}-[a-z]+-\d$")

DEFAULT_DEPLOY_REGION = "us-east-1"
DEFAULT_STACK_NAME_PREFIX = "CloudWeaverStack"
DEFAULT_SETUP_STACK_NAME = "ChatbotConnect"
MAX_CFN_GENERATION_ATTEMPTS = 3
DEPLOYMENT_QUEUE_URL_ENV = "DEPLOYMENT_QUEUE_URL"
MAX_CLEANUP_RETRIES = 3


def get_apigw_management_client(event):
    request_context = event.get("requestContext", {})
    domain_name = request_context.get("domainName")
    stage = request_context.get("stage")

    if not domain_name or not stage:
        return None

    return boto3.client("apigatewaymanagementapi", endpoint_url=f"https://{domain_name}/{stage}")


def get_apigw_management_client_for_endpoint(domain_name: str, stage: str):
    if not domain_name or not stage:
        return None
    return boto3.client("apigatewaymanagementapi", endpoint_url=f"https://{domain_name}/{stage}")


def send_message_to_client(apigw_client, connection_id, message):
    if apigw_client is None or not connection_id:
        print("Unable to send WebSocket message: missing API Gateway client or connection ID")
        return

    try:
        payload = json.dumps(message) if isinstance(message, dict) else str(message)
        apigw_client.post_to_connection(ConnectionId=connection_id, Data=payload.encode("utf-8"))
    except apigw_client.exceptions.GoneException:
        print(f"Connection {connection_id} is gone (disconnected)")
    except Exception as e:
        print(f"Error sending message to {connection_id}: {str(e)}")


def proxy_response(status_code=200, body=None):
    if body is None:
        body = {"ok": True}
    if not isinstance(body, str):
        body = json.dumps(body)
    return {
        "statusCode": status_code,
        "body": body,
    }


def build_response_payload(payload, session_id=None):
    if isinstance(payload, dict):
        response_payload = dict(payload)
    else:
        response_payload = {"message": str(payload)}
    response_payload["sessionID"] = session_id
    return response_payload


def send_ws_and_return(apigw_client, connection_id, payload):
    send_message_to_client(apigw_client, connection_id, payload)
    return proxy_response(200, payload)


def build_user_message_for_storage(user_input: str, feedback: str = None, selected_services: list = None) -> str:
    message_parts = []
    if user_input:
        message_parts.append(user_input.strip())
    if feedback:
        message_parts.append(f"Feedback: {feedback.strip()}")
    if selected_services:
        message_parts.append(f"Selected services: {', '.join(selected_services)}")
    if not message_parts:
        return "User requested architecture guidance."
    return "\n".join(message_parts)


def build_assistant_message_for_storage(result: dict) -> str:
    if not isinstance(result, dict):
        return str(result)

    mermaid_code = result.get("mermaid_code")
    if mermaid_code:
        assistant_text = (result.get("feedback") or result.get("architecture_reasoning") or "").strip()
        return build_assistant_message_content(assistant_text, mermaid_code)

    cloudformation_yaml = result.get("cloudformation_yaml")
    if cloudformation_yaml:
        return "CloudFormation template generated."

    if result.get("error"):
        return f"Backend Error: {result['error']}"

    if result.get("message"):
        return str(result["message"])

    return json.dumps(result)


def parse_event_body(event):
    raw_body = event.get("body", "{}")
    if raw_body is None:
        return {}
    if isinstance(raw_body, dict):
        return raw_body

    if event.get("isBase64Encoded") and isinstance(raw_body, str):
        try:
            raw_body = base64.b64decode(raw_body).decode("utf-8")
        except Exception as e:
            print(f"Failed to decode base64 body: {e}")
            return {}

    if isinstance(raw_body, str):
        raw_body = raw_body.strip()
        if not raw_body:
            return {}
        try:
            return json.loads(raw_body)
        except json.JSONDecodeError as e:
            print(f"Invalid JSON body: {e}; raw={raw_body[:300]}")
            return {}

    return {}


def normalize_session_id(session_id):
    if not isinstance(session_id, str):
        return None
    clean_session_id = session_id.strip()
    return clean_session_id or None


def normalize_selected_services(services):
    if not isinstance(services, list):
        return []
    return [service for service in services if isinstance(service, str) and service in ALLOWED_SERVICE_SET]


def normalize_role_arn(role_arn):
    if not isinstance(role_arn, str):
        return None
    normalized = role_arn.strip()
    if not normalized:
        return None
    if not IAM_ROLE_ARN_PATTERN.match(normalized):
        return None
    return normalized


def assume_cross_account_role(role_arn: str, external_id: str):
    sts_client = boto3.client("sts")
    return sts_client.assume_role(
        RoleArn=role_arn,
        RoleSessionName="ChatbotDeployment",
        ExternalId=external_id,
    )


def _credentials_from_assume_role(assume_role_response: dict) -> dict:
    credentials = assume_role_response.get("Credentials", {})
    return {
        "aws_access_key_id": credentials.get("AccessKeyId"),
        "aws_secret_access_key": credentials.get("SecretAccessKey"),
        "aws_session_token": credentials.get("SessionToken"),
    }


def assumed_role_client(service_name: str, region: str, assume_role_response: dict):
    return boto3.client(service_name, region_name=region, **_credentials_from_assume_role(assume_role_response))


def default_stack_name_for_session(session_id: str) -> str:
    suffix = re.sub(r"[^A-Za-z0-9]", "", session_id or "")[-8:]
    if not suffix:
        suffix = "default"
    return f"{DEFAULT_STACK_NAME_PREFIX}-{suffix}"


def resolve_deployment_inputs(body: dict, session_id: str):
    region_raw = body.get("region")
    stack_name_raw = body.get("stackName")
    setup_stack_name_raw = body.get("setupStackName")

    if region_raw is None or str(region_raw).strip() == "":
        region = DEFAULT_DEPLOY_REGION
    elif isinstance(region_raw, str) and REGION_PATTERN.match(region_raw.strip()):
        region = region_raw.strip()
    else:
        return None, "Region must be a valid AWS region format (for example us-east-1)."

    if stack_name_raw is None or str(stack_name_raw).strip() == "":
        stack_name = default_stack_name_for_session(session_id)
    elif isinstance(stack_name_raw, str) and STACK_NAME_PATTERN.match(stack_name_raw.strip()):
        stack_name = stack_name_raw.strip()
    else:
        return None, "stackName must start with a letter and contain only letters, numbers, and hyphens (max 128 chars)."

    if setup_stack_name_raw is None or str(setup_stack_name_raw).strip() == "":
        setup_stack_name = DEFAULT_SETUP_STACK_NAME
    elif isinstance(setup_stack_name_raw, str) and STACK_NAME_PATTERN.match(setup_stack_name_raw.strip()):
        setup_stack_name = setup_stack_name_raw.strip()
    else:
        return None, "setupStackName must start with a letter and contain only letters, numbers, and hyphens (max 128 chars)."

    # Safety guardrail: cleanup is only ever allowed for ChatbotConnect setup stacks.
    if not setup_stack_name.startswith(DEFAULT_SETUP_STACK_NAME):
        setup_stack_name = DEFAULT_SETUP_STACK_NAME

    return {
        "region": region,
        "stack_name": stack_name,
        "setup_stack_name": setup_stack_name,
    }, None


def _is_stack_not_found_error(error: Exception) -> bool:
    message = str(error)
    return "does not exist" in message and "Stack with id" in message


def get_existing_stack(cfn_client, stack_name: str):
    try:
        stacks = cfn_client.describe_stacks(StackName=stack_name).get("Stacks", [])
        return stacks[0] if stacks else None
    except Exception as exc:
        if _is_stack_not_found_error(exc):
            return None
        raise


def _stringify_validation_issues(issues: list[dict]) -> str:
    if not issues:
        return ""
    return "; ".join(issue.get("message", "Unknown validation issue") for issue in issues)


def run_local_cloudformation_validation(template_body: str) -> dict:
    try:
        from validation.cloudformation_syntax import validate_cloudformation_syntax

        return validate_cloudformation_syntax(template_body)
    except Exception as exc:
        # Keep websocket routes alive even if optional local validator deps are not packaged.
        print(f"Local CloudFormation validator unavailable, continuing with AWS validation only: {exc}")
        return {
            "passed": True,
            "errors": [],
            "warnings": [
                {
                    "rule": "local_validator_unavailable",
                    "message": "Local CloudFormation validator unavailable; relied on AWS validate_template only.",
                }
            ],
        }


def validate_template_with_aws(cfn_client, template_body: str):
    try:
        cfn_client.validate_template(TemplateBody=template_body)
        return True, ""
    except Exception as exc:
        return False, str(exc)


def build_cfn_repair_prompt(
    base_prompt: str,
    previous_template: str,
    local_validation: dict,
    aws_validation_error: str,
    attempt: int,
) -> str:
    local_errors = _stringify_validation_issues(local_validation.get("errors", []))
    local_warnings = _stringify_validation_issues(local_validation.get("warnings", []))
    return (
        f"{base_prompt}\n\n"
        f"Repair attempt {attempt}.\n"
        "The previous CloudFormation YAML failed validation.\n"
        f"Local syntax errors: {local_errors or 'None'}\n"
        f"Local syntax warnings: {local_warnings or 'None'}\n"
        f"AWS validate_template error: {aws_validation_error or 'None'}\n\n"
        "Return corrected CloudFormation YAML only via the tool output.\n\n"
        "Previous YAML:\n"
        f"```yaml\n{previous_template}\n```"
    )


def generate_validated_cloudformation_template(cfn_client, last_assistant_message: str, approved_diagram: str):
    prompt = build_cfn_prompt(last_assistant_message, approved_diagram)
    latest_failure = "CloudFormation generation failed."

    for attempt in range(1, MAX_CFN_GENERATION_ATTEMPTS + 1):
        cfn_sys_prompt = get_system_prompt("cfn-prompt")
        result = invoke_bedrock(cfn_sys_prompt, prompt, tool_type="cloudformation")
        if result.get("error"):
            latest_failure = f"Bedrock generation error (attempt {attempt}): {result.get('error')}"
            continue

        cloudformation_yaml = str(result.get("cloudformation_yaml", "")).strip()
        if not cloudformation_yaml:
            latest_failure = f"Bedrock returned no CloudFormation YAML (attempt {attempt})."
            continue

        local_validation = run_local_cloudformation_validation(cloudformation_yaml)
        aws_valid, aws_validation_error = validate_template_with_aws(cfn_client, cloudformation_yaml)

        print(
            f"CFN validation attempt={attempt} local_passed={local_validation.get('passed')} aws_passed={aws_valid}"
        )

        if local_validation.get("passed") and aws_valid:
            return cloudformation_yaml, attempt

        latest_failure = (
            f"CloudFormation validation failed on attempt {attempt}. "
            f"Local: {_stringify_validation_issues(local_validation.get('errors', [])) or 'None'}. "
            f"AWS: {aws_validation_error or 'None'}."
        )
        prompt = build_cfn_repair_prompt(
            build_cfn_prompt(last_assistant_message, approved_diagram),
            cloudformation_yaml,
            local_validation,
            aws_validation_error,
            attempt,
        )

    raise RuntimeError(latest_failure)


def deploy_cloudformation_stack(cfn_client, stack_name: str, template_body: str):
    existing_stack = get_existing_stack(cfn_client, stack_name)
    if existing_stack:
        existing_status = existing_stack.get("StackStatus")

        if isinstance(existing_status, str) and existing_status.endswith("_IN_PROGRESS"):
            raise RuntimeError(
                f"Deployment is already in progress for stack {stack_name}. "
                "Wait for completion and retry if needed."
            )

        if existing_status in {"CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"}:
            return {
                "stack_id": existing_stack.get("StackId"),
                "operation": "existing",
                "status": existing_status,
            }

        if existing_status in {"ROLLBACK_COMPLETE", "ROLLBACK_FAILED", "CREATE_FAILED"}:
            # Recover from failed stack states so retried deployments can proceed automatically.
            cfn_client.delete_stack(StackName=stack_name)
            try:
                cfn_client.get_waiter("stack_delete_complete").wait(
                    StackName=stack_name,
                    WaiterConfig={"Delay": 5, "MaxAttempts": 120},
                )
            except WaiterError:
                residual_stack = get_existing_stack(cfn_client, stack_name)
                residual_status = (residual_stack or {}).get("StackStatus")
                if not residual_stack:
                    pass
                elif isinstance(residual_status, str) and residual_status.endswith("_IN_PROGRESS"):
                    raise RuntimeError(
                        "Previous failed deployment stack cleanup is still in progress. "
                        "Please retry in a few minutes."
                    )
                else:
                    raise RuntimeError(
                        "Previous failed deployment stack could not be cleaned up automatically. "
                        "Delete the stack manually in CloudFormation and retry."
                    )
            existing_stack = None

        if existing_stack:
            raise RuntimeError(
                f"Stack {stack_name} is in status {existing_status}. Resolve stack state before retrying deployment."
            )

    if not existing_stack:
        create_response = cfn_client.create_stack(
            StackName=stack_name,
            TemplateBody=template_body,
            Capabilities=["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"],
            OnFailure="DELETE",
        )
        stack_id = create_response.get("StackId")
        try:
            cfn_client.get_waiter("stack_create_complete").wait(
                StackName=stack_name,
                WaiterConfig={"Delay": 5, "MaxAttempts": 120},
            )
        except WaiterError:
            latest_stack = get_existing_stack(cfn_client, stack_name)
            latest_status = (latest_stack or {}).get("StackStatus")

            if latest_status == "CREATE_COMPLETE":
                operation = "create"
                return {
                    "stack_id": (latest_stack or {}).get("StackId") or stack_id,
                    "operation": operation,
                    "status": latest_status,
                }

            if not latest_stack:
                raise RuntimeError(
                    "Deployment stack was not created. CloudFormation may have auto-deleted it after create failure."
                )

            if latest_status in {"ROLLBACK_COMPLETE", "ROLLBACK_FAILED", "CREATE_FAILED"}:
                raise RuntimeError(
                    "Deployment creation failed. Review CloudFormation stack events in AWS Console and retry after fixes."
                )

            if isinstance(latest_status, str) and latest_status.endswith("_IN_PROGRESS"):
                raise RuntimeError(
                    "Deployment is still in progress. Check CloudFormation stack events and wait for completion."
                )

            raise RuntimeError(
                f"Deployment reached unexpected stack status {latest_status}. "
                "Review CloudFormation stack events and retry."
            )
        operation = "create"

    final_stack = cfn_client.describe_stacks(StackName=stack_name).get("Stacks", [{}])[0]
    return {
        "stack_id": final_stack.get("StackId") or stack_id,
        "operation": operation,
        "status": final_stack.get("StackStatus"),
    }


def cleanup_setup_stack(cfn_client, setup_stack_name: str, deployed_stack_name: str):
    if not setup_stack_name:
        return {"status": "skipped", "reason": "No setup stack name provided."}

    if setup_stack_name == deployed_stack_name:
        return {
            "status": "skipped",
            "reason": "Setup stack name matches deployed stack; skipping cleanup to avoid deleting deployed resources.",
        }

    if not setup_stack_name.startswith(DEFAULT_SETUP_STACK_NAME):
        return {
            "status": "skipped",
            "reason": "Cleanup is restricted to ChatbotConnect setup stacks only.",
        }

    try:
        described = cfn_client.describe_stacks(StackName=setup_stack_name)
        stack = (described.get("Stacks") or [{}])[0]
        stack_status = stack.get("StackStatus", "")

        if stack_status == "DELETE_IN_PROGRESS":
            return {"status": "in_progress"}
    except Exception as exc:
        if _is_stack_not_found_error(exc):
            return {"status": "not_found"}
        return {"status": "failed", "reason": str(exc)}

    try:
        # Start cleanup without blocking on waiter terminal states.
        cfn_client.delete_stack(StackName=setup_stack_name)
        return {"status": "delete_requested"}
    except Exception as exc:
        return {"status": "failed", "reason": str(exc)}


def user_facing_deployment_error(error: Exception) -> str:
    message = str(error or "")
    lowered = message.lower()

    if "accessdenied" in lowered or "not authorized" in lowered:
        return "Deployment authorization failed. Verify IAM trust policy, permissions, and ExternalID configuration."
    if "cleanup is still in progress" in lowered:
        return "A previous failed deployment cleanup is still running. Retry in a few minutes."
    if "could not be cleaned up automatically" in lowered:
        return "A previous failed deployment stack needs manual cleanup. Delete the stack in CloudFormation, then retry."
    if "deployment stack was not created" in lowered:
        return "Deployment did not create a stack. Review CloudFormation stack events and retry."
    if "deployment is still in progress" in lowered:
        return "Deployment is still in progress. Check CloudFormation stack events and wait for completion."
    if "update_rollback_complete" in lowered:
        return "Deployment update failed and was rolled back. Review CloudFormation stack events in AWS Console and retry after fixes."
    if "create_failed" in lowered or "rollback_complete" in lowered:
        return "Deployment creation failed. Review CloudFormation stack events in AWS Console and retry after fixes."
    if "waiter" in lowered and "stackdeletecomplete" in lowered:
        return "Deployment finished, but setup stack cleanup did not complete. You can delete ChatbotConnect manually from CloudFormation."
    if "waiter" in lowered:
        return "Deployment did not reach a successful terminal state in time. Review CloudFormation stack events for details."
    return "Deployment failed. Review CloudFormation stack events in AWS Console for details and retry."


def run_generate_cloudformation_deployment(session_id: str, role_arn: str, deployment_inputs: dict):
    external_id = get_session_external_id(session_id)
    if not external_id:
        raise ValueError(
            "No ExternalID found for this session. Send a chat message first, then retry authentication."
        )

    assume_role_response = assume_cross_account_role(role_arn, external_id)
    cfn_client = assumed_role_client(
        "cloudformation",
        deployment_inputs["region"],
        assume_role_response,
    )

    # Fast path for duplicate/replayed jobs: avoid regenerating/redeploying when stack already exists.
    existing_stack = get_existing_stack(cfn_client, deployment_inputs["stack_name"])
    existing_status = (existing_stack or {}).get("StackStatus")
    if existing_status in {"CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"}:
        cleanup_result = cleanup_setup_stack(
            cfn_client,
            deployment_inputs["setup_stack_name"],
            deployment_inputs["stack_name"],
        )
        return {
            "suppressClientMessage": True,
            "stackName": deployment_inputs["stack_name"],
            "stackId": (existing_stack or {}).get("StackId"),
            "region": deployment_inputs["region"],
            "deploymentOperation": "existing",
            "cleanup": cleanup_result,
        }

    latest_assistant_context = get_latest_assistant_architecture_context(session_id)
    if not latest_assistant_context:
        raise ValueError(
            "No assistant architecture context is available for this session. "
            "Generate an architecture first, then retry deployment."
        )

    cloudformation_yaml, generation_attempts = generate_validated_cloudformation_template(
        cfn_client,
        latest_assistant_context.get("assistant_message", ""),
        latest_assistant_context.get("mermaid_code", ""),
    )

    deployment_result = deploy_cloudformation_stack(
        cfn_client,
        deployment_inputs["stack_name"],
        cloudformation_yaml,
    )

    cleanup_result = cleanup_setup_stack(
        cfn_client,
        deployment_inputs["setup_stack_name"],
        deployment_inputs["stack_name"],
    )

    cleanup_status = cleanup_result.get("status")
    cleanup_note = ""
    if cleanup_status == "failed":
        cleanup_note = (
            " Deployment succeeded, but setup stack cleanup did not complete. "
            "You can delete ChatbotConnect manually in CloudFormation."
        )
    elif cleanup_status == "delete_requested":
        cleanup_note = " Setup stack cleanup was requested and is now in progress."
    elif cleanup_status in ("skipped", "not_found", "in_progress"):
        cleanup_note = (
            " Setup stack cleanup status: "
            f"{cleanup_status.replace('_', ' ')}"
        )

    success_message = (
        f"Deployment succeeded via {deployment_result.get('operation')} in {deployment_inputs['region']} "
        f"for stack {deployment_inputs['stack_name']} "
        f"(status: {deployment_result.get('status')})."
        f" Template validated after {generation_attempts} attempt(s)."
        f"{cleanup_note}"
    )
    save_message(
        session_id,
        "assistant",
        success_message,
        message_type="standard",
    )

    return {
        "message": success_message,
        "stackName": deployment_inputs["stack_name"],
        "stackId": deployment_result.get("stack_id"),
        "region": deployment_inputs["region"],
        "deploymentOperation": deployment_result.get("operation"),
        "cleanup": cleanup_result,
    }


def enqueue_deployment_job(queue_url: str, request_context: dict, payload: dict):
    sqs_client = boto3.client("sqs")
    job_payload = {
        "sessionID": payload.get("sessionID"),
        "arn": payload.get("arn") or payload.get("roleArn"),
        "region": payload.get("region"),
        "stackName": payload.get("stackName"),
        "setupStackName": payload.get("setupStackName"),
        "connectionId": request_context.get("connectionId"),
        "domainName": request_context.get("domainName"),
        "stage": request_context.get("stage"),
    }
    sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(job_payload),
    )


def enqueue_cleanup_retry_job(queue_url: str, body: dict, retry_count: int):
    sqs_client = boto3.client("sqs")
    delay_seconds = min(900, max(60, retry_count * 180))
    retry_payload = {
        "jobType": "cleanupRetry",
        "cleanupRetryCount": retry_count,
        "sessionID": body.get("sessionID"),
        "arn": body.get("arn") or body.get("roleArn"),
        "roleArn": body.get("roleArn") or body.get("arn"),
        "region": body.get("region"),
        "stackName": body.get("stackName"),
        "setupStackName": body.get("setupStackName"),
        "connectionId": body.get("connectionId"),
        "domainName": body.get("domainName"),
        "stage": body.get("stage"),
    }
    sqs_client.send_message(
        QueueUrl=queue_url,
        DelaySeconds=delay_seconds,
        MessageBody=json.dumps(retry_payload),
    )


def process_deployment_queue_records(records: list[dict]):
    for record in records:
        try:
            body = json.loads(record.get("body", "{}"))
        except Exception:
            print(f"Skipping SQS record with invalid JSON body: {record.get('body')}")
            continue

        session_id = normalize_session_id(body.get("sessionID"))
        role_arn = normalize_role_arn(body.get("arn") or body.get("roleArn"))
        job_type = str(body.get("jobType") or "deploy")
        cleanup_retry_count = int(body.get("cleanupRetryCount") or 0)

        apigw_client = get_apigw_management_client_for_endpoint(
            body.get("domainName"),
            body.get("stage"),
        )
        connection_id = body.get("connectionId")

        if not session_id or not role_arn:
            error_payload = build_response_payload(
                {
                    "error": (
                        "Invalid deployment job payload: missing or invalid sessionID/role ARN."
                    )
                },
                session_id,
            )
            send_message_to_client(apigw_client, connection_id, error_payload)
            continue

        deployment_inputs, deployment_error = resolve_deployment_inputs(body, session_id)
        if deployment_error:
            error_payload = build_response_payload({"error": deployment_error}, session_id)
            send_message_to_client(apigw_client, connection_id, error_payload)
            continue

        receive_count_raw = (record.get("attributes", {}) or {}).get("ApproximateReceiveCount", "1")
        try:
            receive_count = int(receive_count_raw)
        except Exception:
            receive_count = 1

        if receive_count > 1:
            # SQS redelivery can happen after a successful first run. Skip duplicate completion runs.
            try:
                external_id = get_session_external_id(session_id)
                if external_id:
                    assume_role_response = assume_cross_account_role(role_arn, external_id)
                    cfn_client = assumed_role_client(
                        "cloudformation",
                        deployment_inputs["region"],
                        assume_role_response,
                    )
                    existing_stack = get_existing_stack(cfn_client, deployment_inputs["stack_name"])
                    existing_status = (existing_stack or {}).get("StackStatus")
                    if existing_status in {"CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"}:
                        print(
                            "Skipping duplicate SQS delivery for "
                            f"session={session_id}, stack={deployment_inputs['stack_name']}, status={existing_status}"
                        )
                        continue
            except Exception as duplicate_check_error:
                print(f"Duplicate-delivery check failed; processing retry: {duplicate_check_error}")

        if job_type == "deploy" and receive_count == 1:
            send_message_to_client(
                apigw_client,
                connection_id,
                build_response_payload(
                    {
                        "message": (
                            "Deployment job started. Generating and validating CloudFormation template now..."
                        )
                    },
                    session_id,
                ),
            )

        try:
            result_payload = run_generate_cloudformation_deployment(
                session_id,
                role_arn,
                deployment_inputs,
            )

            cleanup_status = (result_payload.get("cleanup") or {}).get("status")
            queue_url = os.getenv(DEPLOYMENT_QUEUE_URL_ENV, "").strip()
            if queue_url and cleanup_status in {"failed", "in_progress", "delete_requested"}:
                next_retry = cleanup_retry_count + 1
                if next_retry <= MAX_CLEANUP_RETRIES:
                    enqueue_cleanup_retry_job(queue_url, body, next_retry)

            if result_payload.get("suppressClientMessage"):
                continue

            if job_type == "deploy":
                send_message_to_client(
                    apigw_client,
                    connection_id,
                    build_response_payload(result_payload, session_id),
                )
        except Exception as exc:
            if is_missing_dynamodb_resource_error(exc):
                error_message = (
                    "Message storage is not configured in DynamoDB. Create the messages table "
                    "(or set MESSAGES_TABLE) before CloudFormation generation."
                )
            else:
                error_message = user_facing_deployment_error(exc)

            if job_type == "deploy":
                send_message_to_client(
                    apigw_client,
                    connection_id,
                    build_response_payload({"error": error_message}, session_id),
                )


def is_missing_dynamodb_resource_error(error: Exception) -> bool:
    message = str(error)
    return "ResourceNotFoundException" in message and "Requested resource not found" in message


def extract_used_services_from_mermaid(mermaid_code):
    used = set()
    source = (mermaid_code or "").lower()
    for service_name, aliases in SERVICE_MATCHERS.items():
        for alias in aliases:
            if alias in source:
                used.add(service_name)
                break
    return used


def normalize_mermaid_code(mermaid_code: str) -> str:
    if not isinstance(mermaid_code, str):
        return mermaid_code

    normalized = mermaid_code.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(
        r"(\]|\)|\}|\"|')\s{2,}([A-Za-z_][\w-]*)\s*(-\.->|-->|==>)",
        r"\1\n\2 \3",
        normalized,
    )
    return normalized


def _normalize_bullet_list(raw_value) -> list[str]:
    if isinstance(raw_value, list):
        return [str(item).strip() for item in raw_value if str(item).strip()]
    if isinstance(raw_value, str) and raw_value.strip():
        return [raw_value.strip()]
    return []


def _ensure_min_bullets(items: list[str], min_count: int, fallback_items: list[str]) -> list[str]:
    normalized = [item for item in items if item]
    for fallback in fallback_items:
        if len(normalized) >= min_count:
            break
        if fallback and fallback not in normalized:
            normalized.append(fallback)
    while len(normalized) < min_count:
        normalized.append("Review workload-specific tradeoffs with your expected traffic and team operations model.")
    return normalized[:max(min_count, len(normalized))]


def _split_sentences(text: str) -> list[str]:
    if not text:
        return []
    return [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", text.strip()) if segment.strip()]


def _ensure_min_sentences(text: str, min_count: int, fallback_sentences: list[str]) -> str:
    sentences = _split_sentences(text)
    for fallback in fallback_sentences:
        if len(sentences) >= min_count:
            break
        if fallback and fallback not in sentences:
            sentences.append(fallback)
    while len(sentences) < min_count:
        sentences.append("This design can be adjusted further based on throughput, budget, and operational constraints.")
    return " ".join(sentences)


def build_architecture_analysis(result: dict, selected_services: list[str], used_services: set[str]) -> dict:
    analysis_payload = result.get("analysis") if isinstance(result.get("analysis"), dict) else {}

    why_raw = (
        analysis_payload.get("why_this_architecture")
        or result.get("why_this_architecture")
        or result.get("architecture_reasoning")
        or ""
    )
    why_this_architecture = _ensure_min_sentences(
        str(why_raw).strip(),
        6,
        [
            f"The selected services ({', '.join(selected_services)}) provide a practical baseline for this workload.",
            "The architecture emphasizes managed services to reduce operational overhead while keeping iteration speed high.",
            "Service boundaries are chosen to keep responsibilities clear across API, compute, storage, and identity.",
            "This layout is designed to support an MVP now and evolve safely as usage grows.",
            "Security and least-privilege access patterns are easier to enforce with this decomposition.",
            "The design also balances development velocity with maintainability for a small engineering team.",
        ],
    )

    pros_raw = _normalize_bullet_list(analysis_payload.get("pros") or result.get("pros"))
    cons_raw = _normalize_bullet_list(analysis_payload.get("cons") or result.get("cons"))

    pros = _ensure_min_bullets(
        pros_raw,
        5,
        [
            "Uses managed AWS components to reduce infrastructure maintenance.",
            "Supports rapid delivery for MVP and iterative product changes.",
            "Aligns well with event-driven and API-based integration patterns.",
            "Can scale by expanding managed service capacity instead of re-architecting immediately.",
            "Provides a clean base for adding monitoring, security, and CI/CD controls.",
        ],
    )

    cons = _ensure_min_bullets(
        cons_raw,
        5,
        [
            "Multiple managed services can increase architecture complexity over time.",
            "Cost visibility requires active monitoring across several AWS billing dimensions.",
            "Service limits and quotas can become bottlenecks if growth is sudden.",
            "Troubleshooting distributed flows is harder than debugging a monolithic system.",
            "Strict IAM and configuration discipline is required to avoid security drift.",
        ],
    )

    improvements_raw = (
        analysis_payload.get("improvements")
        or result.get("improvements")
        or ""
    )
    improvements = _ensure_min_sentences(
        str(improvements_raw).strip(),
        3,
        [
            "Next, add end-to-end observability with metrics, structured logs, and alerting tied to critical user journeys.",
            "Then harden security by validating IAM least-privilege roles, encryption settings, and network boundaries for each component.",
            "Finally, run cost and load tests so you can tune scaling, caching, and data retention before production rollout.",
        ],
    )

    return {
        "why_this_architecture": why_this_architecture,
        "pros": pros,
        "cons": cons,
        "improvements": improvements,
    }


def build_architecture_feedback(analysis: dict, selected_services: list[str], used_services: set[str], result: dict) -> str:
    feedback_lines: list[str] = [
        f"**Why this architecture:** {analysis['why_this_architecture']}",
        "**Pros:**",
    ]

    feedback_lines.extend([f"- {item}" for item in analysis["pros"]])
    feedback_lines.append("**Cons:**")
    feedback_lines.extend([f"- {item}" for item in analysis["cons"]])
    feedback_lines.append(f"**Improvements:** {analysis['improvements']}")
    feedback_lines.append(f"**Selected services:** {', '.join(selected_services)}")

    if used_services:
        feedback_lines.append(f"**Detected in diagram:** {', '.join(sorted(used_services))}")

    syntax_result = validate_mermaid_syntax(result.get("mermaid_code", ""))
    if syntax_result.get("warnings"):
        warnings = "; ".join(item["message"] for item in syntax_result["warnings"][:3])
        feedback_lines.append(f"**Validation notes:** {warnings}")

    return "\n\n".join(feedback_lines)


def handler(event, context):
    if isinstance(event.get("Records"), list) and event.get("Records"):
        first_record = event["Records"][0]
        if first_record.get("eventSource") == "aws:sqs":
            process_deployment_queue_records(event["Records"])
            return proxy_response(200, {"processed": len(event["Records"])})

    request_context = event.get("requestContext", {})
    route = request_context.get("routeKey", "")
    connection_id = request_context.get("connectionId", "")
    apigw_client = get_apigw_management_client(event)

    try:
        body = parse_event_body(event)

        if route == "$default":
            route = body.get("action", "$default")

        if route in ("$connect", "$disconnect"):
            return proxy_response(200)

        if route == "getExternalId":
            session_id = normalize_session_id(body.get("sessionID"))
            if not session_id:
                error_payload = build_response_payload(
                    {"error": "sessionID is required to retrieve ExternalID."}
                )
                return send_ws_and_return(apigw_client, connection_id, error_payload)

            try:
                external_id = ensure_session_external_id(session_id)
                payload = build_response_payload({"externalID": external_id}, session_id)
                return send_ws_and_return(apigw_client, connection_id, payload)
            except Exception as e:
                if is_missing_dynamodb_resource_error(e):
                    error_payload = build_response_payload(
                        {
                            "error": (
                                "Message storage is not configured in DynamoDB. "
                                "Create the messages table (or set MESSAGES_TABLE) before "
                                "requesting an ExternalID."
                            )
                        },
                        session_id,
                    )
                    return send_ws_and_return(apigw_client, connection_id, error_payload)

                error_payload = build_response_payload(
                    {"error": f"Failed to retrieve ExternalID: {str(e)}"},
                    session_id,
                )
                return send_ws_and_return(apigw_client, connection_id, error_payload)

        if route in ("sendMessage", "rejectDiagram"):
            user_input = body.get("userInput", "")
            feedback = body.get("feedback", None)
            selected_services = normalize_selected_services(body.get("services", []))

            if not selected_services:
                payload = {"error": "Please select at least one allowed AWS service before generating a diagram."}
                return send_ws_and_return(apigw_client, connection_id, payload)

            if not user_input and not feedback:
                return send_ws_and_return(apigw_client, connection_id, {"error": "Missing userInput/feedback"})

            session_id = normalize_session_id(body.get("sessionID"))
            if not session_id:
                session_id = generate_session_id()

            try:
                chat_history = []
                persistence_available = True
                external_id = None

                try:
                    external_id = ensure_session_external_id(session_id)
                    chat_history = get_recent_chat_messages(session_id)

                    user_message_for_storage = build_user_message_for_storage(
                        user_input,
                        feedback,
                        selected_services,
                    )
                    save_message(
                        session_id,
                        "user",
                        user_message_for_storage,
                        message_type="standard",
                    )
                except Exception as persistence_error:
                    if is_missing_dynamodb_resource_error(persistence_error):
                        persistence_available = False
                        print(
                            "Message persistence unavailable (missing DynamoDB table). "
                            "Continuing in stateless mode for this request."
                        )
                    else:
                        raise

                prompt = build_prompt(user_input, feedback, selected_services)
                sys_prompt = get_system_prompt("system-prompt")
                result = invoke_bedrock(sys_prompt, prompt, conversation_history=chat_history)

                if result.get("mermaid_code"):
                    result["mermaid_code"] = normalize_mermaid_code(result.get("mermaid_code", ""))
                    used_services = extract_used_services_from_mermaid(result.get("mermaid_code", ""))
                    selected_set = set(selected_services)
                    disallowed = sorted(service for service in used_services if service not in selected_set)
                    if disallowed:
                        result = {
                            "error": (
                                "Generated diagram used services outside your selected set: "
                                f"{', '.join(disallowed)}. "
                                f"Selected services: {', '.join(selected_services)}."
                            )
                        }
                    else:
                        analysis = build_architecture_analysis(result, selected_services, used_services)
                        result["analysis"] = analysis
                        result["feedback"] = build_architecture_feedback(
                            analysis,
                            selected_services,
                            used_services,
                            result,
                        )

                if persistence_available:
                    assistant_content = build_assistant_message_for_storage(result)
                    save_message(
                        session_id,
                        "assistant",
                        assistant_content,
                        message_type="standard",
                    )

                payload = build_response_payload(result, session_id)
                if external_id:
                    payload["externalID"] = external_id
                return send_ws_and_return(apigw_client, connection_id, payload)
            except Exception as e:
                error_payload = build_response_payload(
                    {"error": f"Failed to process chat request: {str(e)}"},
                    session_id,
                )
                return send_ws_and_return(apigw_client, connection_id, error_payload)

        if route == "generateCloudFormation":
            session_id = normalize_session_id(body.get("sessionID"))
            if not session_id:
                error_payload = build_response_payload(
                    {"error": "sessionID is required for CloudFormation generation."}
                )
                return send_ws_and_return(apigw_client, connection_id, error_payload)

            role_arn = normalize_role_arn(body.get("arn") or body.get("roleArn"))
            if not role_arn:
                error_payload = build_response_payload(
                    {"error": "A valid IAM role ARN is required for authentication."},
                    session_id,
                )
                return send_ws_and_return(apigw_client, connection_id, error_payload)

            deployment_inputs, deployment_error = resolve_deployment_inputs(body, session_id)
            if deployment_error:
                error_payload = build_response_payload({"error": deployment_error}, session_id)
                return send_ws_and_return(apigw_client, connection_id, error_payload)

            try:
                queue_url = os.getenv(DEPLOYMENT_QUEUE_URL_ENV, "").strip()

                if queue_url:
                    enqueue_deployment_job(queue_url, request_context, body)
                    queued_message = (
                        "Deployment request accepted. Job queued and running asynchronously. "
                        "You will receive a follow-up message when deployment finishes."
                    )
                    payload = build_response_payload(
                        {
                            "message": queued_message,
                            "jobQueued": True,
                            "stackName": deployment_inputs["stack_name"],
                            "region": deployment_inputs["region"],
                        },
                        session_id,
                    )
                    return send_ws_and_return(apigw_client, connection_id, payload)

                # Fallback sync path for local/test environments without SQS wiring.
                result_payload = run_generate_cloudformation_deployment(
                    session_id,
                    role_arn,
                    deployment_inputs,
                )
                payload = build_response_payload(result_payload, session_id)
                return send_ws_and_return(apigw_client, connection_id, payload)
            except Exception as e:
                if is_missing_dynamodb_resource_error(e):
                    error_payload = build_response_payload(
                        {
                            "error": (
                                "Message storage is not configured in DynamoDB. "
                                "Create the messages table (or set MESSAGES_TABLE) before "
                                "CloudFormation generation."
                            )
                        },
                        session_id,
                    )
                    return send_ws_and_return(apigw_client, connection_id, error_payload)

                error_payload = build_response_payload(
                    {"error": user_facing_deployment_error(e)},
                    session_id,
                )
                return send_ws_and_return(apigw_client, connection_id, error_payload)

        return proxy_response(400, {"error": f"Unknown route: {route}"})

    except Exception as e:
        print(f"Unhandled handler exception: {e}")
        send_message_to_client(apigw_client, connection_id, {"error": f"Internal handler error: {str(e)}"})
        return proxy_response(200)


def build_prompt(user_input: str, feedback: str = None, selected_services: list = None) -> str:
    services_text = ""
    if selected_services:
        services_text = f"\n\nSelected AWS services to use: {', '.join(selected_services)}."

    if feedback:
        return (
            f"Original idea: {user_input}\n\n"
            f"The user rejected the previous architecture with this feedback:\n"
            f"{feedback}\n\n"
            f"Please revise the architecture accordingly.{services_text}"
        )

    return f"The user wants to build: {user_input}{services_text}"


def build_cfn_prompt(last_assistant_message: str, approved_diagram: str) -> str:
    return (
        "Use only the context below from the latest assistant architecture response.\n\n"
        f"Latest assistant message:\n{last_assistant_message}\n\n"
        "Approved architecture diagram:\n\n"
        f"```mermaid\n{approved_diagram}\n```\n\n"
        "Generate the CloudFormation YAML template."
    )
