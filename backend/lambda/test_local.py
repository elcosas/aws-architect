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

print("Running local test for Mermaid Diagram generation...")
response = handler(event, None)

print("\n--- Diagram Response Status Code ---")
print(response.get("statusCode"))

print("\n--- Diagram Response Body ---")
try:
    body = json.loads(response.get("body", "{}"))
    print(json.dumps(body, indent=2))
except Exception:
    print(response.get("body"))

# ---------------------------------------------------------
# Step 2: Mock CloudFormation Generation Event
# ---------------------------------------------------------
cfn_event = {
    "requestContext": {
        "routeKey": "generateCloudFormation",
        "connectionId": "test-local-connection-id"
    },
    "body": json.dumps({
        "userInput": "A serverless application where users upload images, they get processed, and the metadata is saved.",
        "services": ["Lambda", "S3", "DynamoDB"],
        "approvedDiagram": "graph LR\n    User((User)) --> S3[S3 Bucket<br/>Image Upload]\n    S3 --> Lambda[Lambda Function<br/>Image Processing]\n    Lambda --> DynamoDB[DynamoDB<br/>Metadata Storage]\n    Lambda --> S3_Processed[S3 Bucket<br/>Processed Images]"
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
