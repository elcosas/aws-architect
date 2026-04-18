import json
import os
from bedrock_client import invoke_bedrock

SYSTEM_PROMPT = open(
    os.path.join(os.path.dirname(__file__), "system-prompt.txt")
).read()

# ---------------------------------------------------------
# Step 1: AWS Lambda entry point
# Handles API Gateway WebSocket events and routes incoming
# messages to process user architecture requests.
# ---------------------------------------------------------
def handler(event, context):
    # Extract route key and connection ID
    route = event["requestContext"]["routeKey"]
    connection_id = event["requestContext"]["connectionId"]

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

        # Return the generated Mermaid JS diagram
        return {
            "statusCode": 200,
            "body": json.dumps(result)
        }

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