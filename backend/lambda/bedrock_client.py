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

def invoke_bedrock(system_prompt: str, user_message: str) -> dict:
    try:
        response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=[{
                "role": "user",
                "content": [{"text": user_message}]
            }],
            toolConfig={"tools": TOOL_DEFINITIONS}
        )

        content = response["output"]["message"]["content"]
        for block in content:
            if block.get("toolUse"):
                return block["toolUse"]["input"]

        return {"error": "Bedrock did not return a tool call"}

    except Exception as e:
        return {"error": str(e)}