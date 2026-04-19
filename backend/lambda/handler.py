import json
import os
import base64
import boto3
from bedrock_client import invoke_bedrock
from session_store import (
    ensure_session,
    generate_session_id,
    get_latest_assistant_architecture_context,
    get_recent_chat_messages,
    save_message,
)

SYSTEM_PROMPT = open(
    os.path.join(os.path.dirname(__file__), "system-prompt.txt")
).read()

CFN_SYSTEM_PROMPT = open(
    os.path.join(os.path.dirname(__file__), "cfn-prompt.txt")
).read()

# ---------------------------------------------------------
# Initialize API Gateway Management API client for WebSocket responses
# ---------------------------------------------------------
def get_apigw_management_client(event):
    request_context = event.get("requestContext", {})
    domain_name = request_context.get("domainName")
    stage = request_context.get("stage")

    if not domain_name or not stage:
        return None

    return boto3.client("apigatewaymanagementapi", endpoint_url=f"https://{domain_name}/{stage}")

# ---------------------------------------------------------
# Send message back to client through WebSocket
# ---------------------------------------------------------
def send_message_to_client(apigw_client, connection_id, message):
    if apigw_client is None or not connection_id:
        print("Unable to send WebSocket message: missing API Gateway client or connection ID")
        return 

    try:
        payload = json.dumps(message) if isinstance(message, dict) else str(message)
        apigw_client.post_to_connection(
            ConnectionId=connection_id,
            Data=payload.encode("utf-8")
        )
    except apigw_client.exceptions.GoneException:
        print(f"Connection {connection_id} is gone (disconnected)")
    except Exception as e:
        print(f"Error sending message to {connection_id}: {str(e)}")


def build_response_payload(payload, session_id=None):
    if isinstance(payload, dict):
        response_payload = dict(payload)
    else:
        response_payload = {"message": str(payload)}

    response_payload["sessionID"] = session_id

    return response_payload


def send_ws_and_return(apigw_client, connection_id, payload):
    send_message_to_client(apigw_client, connection_id, payload)
    return {
        "statusCode": 200,
        "body": json.dumps(payload),
    }


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


def build_assistant_message_for_storage(result: dict) -> tuple[str, str | None, str | None]:
    if not isinstance(result, dict):
        return str(result), None, None

    mermaid_code = result.get("mermaid_code")
    if mermaid_code:
        return f"```mermaid\n{mermaid_code}\n```", mermaid_code, None

    cloudformation_yaml = result.get("cloudformation_yaml")
    if cloudformation_yaml:
        return f"```yaml\n{cloudformation_yaml}\n```", None, cloudformation_yaml

    if result.get("error"):
        return f"Backend Error: {result['error']}", None, None

    if result.get("message"):
        return str(result["message"]), None, None

    return json.dumps(result), None, None

def proxy_response(status_code=200, body=None):
    """Return a Lambda proxy-compatible response for API Gateway WebSocket integrations."""
    if body is None:
        body = {"ok": True}
    if not isinstance(body, str):
        body = json.dumps(body)
    return {
        "statusCode": status_code,
        "body": body,
    }

# ---------------------------------------------------------
# Step 1: AWS Lambda entry point
# Handles API Gateway WebSocket events and routes incoming
# messages to process user architecture requests.
# ---------------------------------------------------------
def handler(event, context):
    request_context = event.get("requestContext", {})
    route = request_context.get("routeKey", "")
    connection_id = request_context.get("connectionId", "")

    try:
        body = parse_event_body(event)

        # Support deployments where API Gateway uses "$default" plus action in body
        if route == "$default":
            route = body.get("action", "$default")

        # Handle the initial connection handshake
        if route == "$connect":
            return proxy_response(200)

        # Handle the disconnect event
        if route == "$disconnect":
            return proxy_response(200)

        apigw_client = get_apigw_management_client(event)

        # Process user messages and diagram rejections
        if route in ("sendMessage", "rejectDiagram"):
            user_input = body.get("userInput", "")
            feedback = body.get("feedback", None)
            selected_services = body.get("services", [])

            if not user_input and not feedback:
                send_message_to_client(apigw_client, connection_id, {"error": "Missing userInput/feedback"})
                return proxy_response(200)

    # Process user messages and diagram rejections
    if route in ("sendMessage", "rejectDiagram"):
        user_input = body.get("userInput", "")
        feedback = body.get("feedback", None)
        selected_services = body.get("services", [])
        if not isinstance(selected_services, list):
            selected_services = []

        session_id = normalize_session_id(body.get("sessionID"))
        if not session_id:
            session_id = generate_session_id()

        try:
            ensure_session(session_id)
            chat_history = get_recent_chat_messages(session_id)

            user_message_for_storage = build_user_message_for_storage(user_input, feedback, selected_services)
            save_message(session_id, "user", user_message_for_storage)

            # Build the system prompt and invoke Bedrock with persisted history.
            prompt = build_prompt(user_input, feedback, selected_services)
            result = invoke_bedrock(
                SYSTEM_PROMPT,
                prompt,
                conversation_history=chat_history,
            )

            assistant_content, mermaid_code, cloudformation_yaml = build_assistant_message_for_storage(result)
            save_message(
                session_id,
                "assistant",
                assistant_content,
                mermaid_code=mermaid_code,
                cloudformation_yaml=cloudformation_yaml,
            )

            payload = build_response_payload(result, session_id)
            return send_ws_and_return(apigw_client, connection_id, payload)
        except Exception as e:
            error_payload = build_response_payload(
                {"error": f"Failed to process chat request: {str(e)}"},
                session_id,
            )
            return send_ws_and_return(apigw_client, connection_id, error_payload)

    # Generate CloudFormation based on approved diagram
    if route == "generateCloudFormation":
        session_id = normalize_session_id(body.get("sessionID"))
        if not session_id:
            error_payload = build_response_payload(
                {"error": "sessionID is required for CloudFormation generation."}
            )
            return send_ws_and_return(apigw_client, connection_id, error_payload)

        try:
            ensure_session(session_id)
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
            save_message(session_id, "user", deployment_request_message)

            # Enforce exception rule: only use latest assistant response and Mermaid diagram.
            prompt = build_cfn_prompt(
                architecture_context["assistant_message"],
                architecture_context["mermaid_code"],
            )
            result = invoke_bedrock(CFN_SYSTEM_PROMPT, prompt, tool_type="cloudformation")

            assistant_content, _, cloudformation_yaml = build_assistant_message_for_storage(result)
            save_message(
                session_id,
                "assistant",
                assistant_content,
                cloudformation_yaml=cloudformation_yaml,
            )

            payload = build_response_payload(result, session_id)
            return send_ws_and_return(apigw_client, connection_id, payload)
        except Exception as e:
            error_payload = build_response_payload(
                {"error": f"Failed to generate CloudFormation: {str(e)}"},
                session_id,
            )
            return send_ws_and_return(apigw_client, connection_id, error_payload)

    except Exception as e:
        print(f"Unhandled handler exception: {e}")
        apigw_client = get_apigw_management_client(event)
        send_message_to_client(apigw_client, connection_id, {"error": f"Internal handler error: {str(e)}"})
        return proxy_response(200)

# ---------------------------------------------------------
# Step 2: Prompt Construction
# Combines the user's idea, any rejection feedback, and
# their selected AWS services to send to Bedrock.
# ---------------------------------------------------------
def build_prompt(user_input: str, feedback: str = None, selected_services: list = None) -> str:
    # Append selected services if any
    services_text = ""
    if selected_services:
        services_text = f"\n\nSelected AWS services to use: {', '.join(selected_services)}."

    # Incorporate rejection feedback if it exists
    if feedback:
        return (
            f"Original idea: {user_input}\n\n"
            f"The user rejected the previous architecture with this feedback:\n"
            f"{feedback}\n\n"
            f"Please revise the architecture accordingly.{services_text}"
        )
    return f"The user wants to build: {user_input}{services_text}"

# ---------------------------------------------------------
# Step 3: CloudFormation Prompt Construction
# Formats the final approved diagram for CFN generation.
# ---------------------------------------------------------
def build_cfn_prompt(last_assistant_message: str, approved_diagram: str) -> str:
    return (
        "Use only the context below from the latest assistant architecture response.\n\n"
        f"Latest assistant message:\n{last_assistant_message}\n\n"
        "Approved architecture diagram:\n\n"
        f"```mermaid\n{approved_diagram}\n```\n\n"
        f"Generate the CloudFormation YAML template."
    )
