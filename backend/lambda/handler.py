import json
import os
import base64
import boto3
from bedrock_client import invoke_bedrock

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


def parse_event_body(event):
    """Parse API Gateway WebSocket event body safely for proxy/non-proxy shapes."""
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

            # Build the system prompt and invoke Bedrock
            prompt = build_prompt(user_input, feedback, selected_services)
            result = invoke_bedrock(SYSTEM_PROMPT, prompt)

            # Send the generated Mermaid JS diagram back through WebSocket
            send_message_to_client(apigw_client, connection_id, result)
            return proxy_response(200)

        # Generate CloudFormation based on approved diagram
        if route == "generateCloudFormation":
            user_input = body.get("userInput", "")
            approved_diagram = body.get("approvedDiagram", "")
            selected_services = body.get("services", [])

            prompt = build_cfn_prompt(user_input, approved_diagram, selected_services)
            result = invoke_bedrock(CFN_SYSTEM_PROMPT, prompt, tool_type="cloudformation")

            # Send the CloudFormation result back through WebSocket
            send_message_to_client(apigw_client, connection_id, result)
            return proxy_response(200)

        send_message_to_client(apigw_client, connection_id, {"error": f"Unknown route: {route}"})
        return proxy_response(200)

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
def build_cfn_prompt(user_input: str, approved_diagram: str, selected_services: list) -> str:
    services_text = ""
    if selected_services:
        services_text = f" They requested using these specific services: {', '.join(selected_services)}."

    return (
        f"The user wants to build: {user_input}.{services_text}\n\n"
        f"They have approved the following architecture diagram:\n\n"
        f"```mermaid\n{approved_diagram}\n```\n\n"
        f"Generate the CloudFormation YAML template."
    )