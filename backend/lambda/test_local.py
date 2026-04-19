# ---------------------------------------------------------
# Step 1: Initialize local testing script
# Simulates an API Gateway WebSocket event and invokes the
# Lambda handler directly without deploying to AWS.
# ---------------------------------------------------------
import json
import os

# Set a default region if not already in your environment
if "AWS_REGION" not in os.environ:
    os.environ["AWS_REGION"] = "us-east-1"

from handler import handler

# Mock the API Gateway WebSocket event
first_event = {
    "requestContext": {
        "routeKey": "sendMessage",
        "connectionId": "test-local-connection-id"
    },
    "body": json.dumps({
        "sessionID": None,
        "userInput": "A serverless application where users upload images, they get processed, and the metadata is saved.",
        "services": ["Lambda", "S3", "DynamoDB"]
    })
}

print("Running local test for first-message session creation...")
first_response = handler(first_event, None)

print("\n--- Diagram Response Status Code ---")
print(first_response.get("statusCode"))

print("\n--- Diagram Response Body ---")
session_id = None
try:
    first_body = json.loads(first_response.get("body", "{}"))
    session_id = first_body.get("sessionID")
    print(json.dumps(first_body, indent=2))
except Exception:
    print(first_response.get("body"))

print(f"\n--- SessionID returned by backend ---\n{session_id}")

second_event = {
    "requestContext": {
        "routeKey": "sendMessage",
        "connectionId": "test-local-connection-id"
    },
    "body": json.dumps({
        "sessionID": session_id,
        "userInput": "Please add CloudFront in front of API Gateway.",
        "services": ["Lambda", "S3", "DynamoDB", "CloudFront", "API Gateway"]
    })
}

print("\n\nRunning local test for session reuse...")
second_response = handler(second_event, None)

print("\n--- Session Reuse Response Status Code ---")
print(second_response.get("statusCode"))

print("\n--- Session Reuse Response Body ---")
try:
    second_body = json.loads(second_response.get("body", "{}"))
    print(json.dumps(second_body, indent=2))
except Exception:
    print(second_response.get("body"))

# ---------------------------------------------------------
# Step 2: Mock CloudFormation Generation Event
# ---------------------------------------------------------
cfn_event = {
    "requestContext": {
        "routeKey": "generateCloudFormation",
        "connectionId": "test-local-connection-id"
    },
    "body": json.dumps({
        "sessionID": session_id,
        "userInput": "Generate CloudFormation for the latest approved architecture.",
        "arn": "arn:aws:iam::123456789012:role/ChatbotIntegrationRole-ChatbotConnect"
    })
}

print("\n\nRunning local test for CloudFormation generation...")
cfn_response = handler(cfn_event, None)

print("\n--- CFN Response Status Code ---")
print(cfn_response.get("statusCode"))

print("\n--- CFN Response Body ---")
try:
    cfn_body = json.loads(cfn_response.get("body", "{}"))
    print(json.dumps(cfn_body, indent=2))
except Exception:
    print(cfn_response.get("body"))
