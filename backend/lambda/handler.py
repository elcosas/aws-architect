import json
import os
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
    domain_name = event["requestContext"]["domainName"]
    stage = event["requestContext"]["stage"]
    return boto3.client("apigatewaymanagementapi", endpoint_url=f"https://{domain_name}/{stage}")

# ---------------------------------------------------------
# Send message back to client through WebSocket
# ---------------------------------------------------------
def send_message_to_client(apigw_client, connection_id, message):
    try:
        apigw_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message) if isinstance(message, dict) else message
        )
    except apigw_client.exceptions.GoneException:
        print(f"Connection {connection_id} is gone (disconnected)")
    except Exception as e:
        print(f"Error sending message to {connection_id}: {str(e)}")

# ---------------------------------------------------------
# Step 1: AWS Lambda entry point
# Handles API Gateway WebSocket events and routes incoming
# messages to process user architecture requests.
# ---------------------------------------------------------
def handler(event, context):
    # Extract route key and connection ID
    route = event["requestContext"]["routeKey"]
    connection_id = event["requestContext"]["connectionId"]
    apigw_client = get_apigw_management_client(event)

    # Handle the initial connection handshake
    if route == "$connect":
        return {"statusCode": 200}

    # Handle the disconnect event
    if route == "$disconnect":
        return {"statusCode": 200}

    # Process user messages and diagram rejections
    if route in ("sendMessage", "rejectDiagram"):
        # Parse the JSON body from the incoming event
        body = json.loads(event.get("body", "{}"))
        user_input = body.get("userInput", "")
        feedback = body.get("feedback", None)
        selected_services = body.get("services", [])

        # Build the system prompt and invoke Bedrock
        prompt = build_prompt(user_input, feedback, selected_services)
        result = invoke_bedrock(SYSTEM_PROMPT, prompt)

        # Send the generated Mermaid JS diagram back through WebSocket
        send_message_to_client(apigw_client, connection_id, result)
        return {"statusCode": 200}

    # Generate CloudFormation based on approved diagram
    if route == "generateCloudFormation":
        body = json.loads(event.get("body", "{}"))
        user_input = body.get("userInput", "")
        approved_diagram = body.get("approvedDiagram", "")
        selected_services = body.get("services", [])

        prompt = build_cfn_prompt(user_input, approved_diagram, selected_services)
        result = invoke_bedrock(CFN_SYSTEM_PROMPT, prompt, tool_type="cloudformation")

        # Send the CloudFormation result back through WebSocket
        send_message_to_client(apigw_client, connection_id, result)
        return {"statusCode": 200}

    return {"statusCode": 400, "body": "Unknown route"}

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