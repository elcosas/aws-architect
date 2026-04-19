import base64
import json
import os
import re

import boto3

from bedrock_client import invoke_bedrock
from session_store import (
    build_assistant_message_content,
    generate_session_id,
    get_latest_assistant_architecture_context,
    get_recent_chat_messages,
    save_message,
)
from validation import validate_mermaid_syntax

SYSTEM_PROMPT = open(
    os.path.join(os.path.dirname(__file__), "system-prompt.txt")
).read()

CFN_SYSTEM_PROMPT = open(
    os.path.join(os.path.dirname(__file__), "cfn-prompt.txt")
).read()

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


def get_apigw_management_client(event):
    request_context = event.get("requestContext", {})
    domain_name = request_context.get("domainName")
    stage = request_context.get("stage")

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


def build_architecture_feedback(result: dict, selected_services: list[str], used_services: set[str]) -> str:
    feedback_lines: list[str] = []

    reasoning = (result.get("architecture_reasoning") or "").strip()
    if reasoning:
        feedback_lines.append(f"**Why this architecture:** {reasoning}")

    feedback_lines.append(f"**Selected services:** {', '.join(selected_services)}")
    if used_services:
        feedback_lines.append(f"**Detected in diagram:** {', '.join(sorted(used_services))}")

    syntax_result = validate_mermaid_syntax(result.get("mermaid_code", ""))
    if syntax_result.get("warnings"):
        warnings = "; ".join(item["message"] for item in syntax_result["warnings"][:3])
        feedback_lines.append(f"**Validation notes:** {warnings}")

    return "\n\n".join(feedback_lines)


def handler(event, context):
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

                try:
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
                result = invoke_bedrock(SYSTEM_PROMPT, prompt, conversation_history=chat_history)

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
                        result["feedback"] = build_architecture_feedback(result, selected_services, used_services)

                if persistence_available:
                    assistant_content = build_assistant_message_for_storage(result)
                    save_message(
                        session_id,
                        "assistant",
                        assistant_content,
                        message_type="standard",
                    )

                payload = build_response_payload(result, session_id)
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

            try:
                architecture_context = get_latest_assistant_architecture_context(session_id)
                if not architecture_context:
                    error_payload = build_response_payload(
                        {
                            "error": (
                                "No assistant architecture context found for this session. "
                                "Send a chat message first."
                            )
                        },
                        session_id,
                    )
                    return send_ws_and_return(apigw_client, connection_id, error_payload)

                deployment_request_message = body.get(
                    "userInput", "Generate CloudFormation for the latest approved architecture."
                )
                save_message(
                    session_id,
                    "user",
                    deployment_request_message,
                    message_type="standard",
                )

                prompt = build_cfn_prompt(
                    architecture_context["assistant_message"],
                    architecture_context["mermaid_code"],
                )
                result = invoke_bedrock(CFN_SYSTEM_PROMPT, prompt, tool_type="cloudformation")

                assistant_content = build_assistant_message_for_storage(result)
                save_message(
                    session_id,
                    "assistant",
                    assistant_content,
                    message_type="standard",
                )

                payload = build_response_payload(result, session_id)
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
                    {"error": f"Failed to generate CloudFormation: {str(e)}"},
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
