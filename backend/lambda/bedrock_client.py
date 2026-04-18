import boto3
import json
import os

bedrock = boto3.client(
    "bedrock-runtime",
    region_name="us-west-2"
)

MODEL_ID = "us.anthropic.claude-opus-4-5-20251101-v1:0"

TOOL_DEFINITIONS = [
    {
        "toolSpec": {
            "name": "select_architecture",
            "description": "Generate mermaid JS code for the cloud architecture. Always use this tool.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "mermaid_code": {
                            "type": "string",
                            "description": "Valid Mermaid JS code using graph LR syntax"
                        }
                    },
                    "required": ["mermaid_code"]
                }
            }
        }
    }
]

# ---------------------------------------------------------
# Step 1: Invoke Amazon Bedrock
# Uses the Converse API to query the Claude model, forcing
# it to return a structured JSON tool call with Mermaid JS.
# ---------------------------------------------------------
def invoke_bedrock(system_prompt: str, user_message: str) -> dict:
    try:
        # Call the Bedrock Converse API with the Claude model
        response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=[{
                "role": "user",
                "content": [{"text": user_message}]
            }],
            toolConfig={"tools": TOOL_DEFINITIONS}
        )

        # Extract the content blocks from the response message
        content = response["output"]["message"]["content"]
        
        # Search for and return the first tool use JSON block
        for block in content:
            if block.get("toolUse"):
                return block["toolUse"]["input"]

        # Return an error if Claude didn't use the required tool
        return {"error": "Bedrock did not return a tool call"}

    except Exception as e:
        # Catch and return any API or validation errors
        return {"error": str(e)}