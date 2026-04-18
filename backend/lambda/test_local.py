import json
import os

# Set a default region if not already in your environment
if "AWS_REGION" not in os.environ:
    os.environ["AWS_REGION"] = "us-east-1"

from handler import handler

# Mock the API Gateway WebSocket event
event = {
    "requestContext": {
        "routeKey": "sendMessage",
        "connectionId": "test-local-connection-id"
    },
    "body": json.dumps({
        "userInput": "A serverless application where users upload images, they get processed, and the metadata is saved.",
        "services": ["Lambda", "S3", "DynamoDB"]
    })
}

print("Running local test...")
response = handler(event, None)

print("\n--- Response Status Code ---")
print(response.get("statusCode"))

print("\n--- Response Body ---")
try:
    # Try to pretty-print the JSON response if possible
    body = json.loads(response.get("body", "{}"))
    print(json.dumps(body, indent=2))
except Exception:
    # Fallback to plain print
    print(response.get("body"))
