import json
import os
from bedrock_client import invoke_bedrock

SYSTEM_PROMPT = open(
    os.path.join(os.path.dirname(__file__), "system-prompt.txt")
).read()

def handler(event, context):
    route = event["requestContext"]["routeKey"]
    connection_id = event["requestContext"]["connectionId"]

    if route == "$connect":
        return {"statusCode": 200}

    if route == "$disconnect":
        return {"statusCode": 200}

    if route in ("sendMessage", "rejectDiagram"):
        body = json.loads(event.get("body", "{}"))
        user_input = body.get("userInput", "")
        feedback = body.get("feedback", None)
        selected_services = body.get("services", [])

        prompt = build_prompt(user_input, feedback, selected_services)
        result = invoke_bedrock(SYSTEM_PROMPT, prompt)

        return {
            "statusCode": 200,
            "body": json.dumps(result)
        }

    return {"statusCode": 400, "body": "Unknown route"}

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