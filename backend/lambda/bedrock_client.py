import boto3
import json
import os
import re

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

CFN_TOOL_DEFINITIONS = [
    {
        "toolSpec": {
            "name": "generate_cfn",
            "description": "Generate AWS CloudFormation YAML code. Always use this tool.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "cloudformation_yaml": {
                            "type": "string",
                            "description": "Valid AWS CloudFormation YAML code"
                        }
                    },
                    "required": ["cloudformation_yaml"]
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
def invoke_bedrock(system_prompt: str, user_message: str, tool_type: str = "mermaid") -> dict:
    try:
        # Select the correct tool schema based on the requested type
        tools = CFN_TOOL_DEFINITIONS if tool_type == "cloudformation" else TOOL_DEFINITIONS
        tool_name = "generate_cfn" if tool_type == "cloudformation" else "select_architecture"

        # Call the Bedrock Converse API with the Claude model
        response = bedrock.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=[{
                "role": "user",
                "content": [{"text": user_message}]
            }],
            toolConfig={
                "tools": tools,
                "toolChoice": {"tool": {"name": tool_name}}
            }
        )

        # Extract the content blocks from the response message
        content = response["output"]["message"]["content"]
        
        # Search for and return the first tool use JSON block
        for block in content:
            if block.get("toolUse"):
                return block["toolUse"]["input"]

        # Fallback: extract plain text if model responded without a tool call
        text_chunks = [block.get("text", "") for block in content if isinstance(block, dict)]
        combined_text = "\n".join(chunk for chunk in text_chunks if chunk).strip()

        if combined_text:
            if tool_type == "cloudformation":
                yaml_match = re.search(r"```(?:yaml|yml)?\n([\s\S]*?)```", combined_text, re.IGNORECASE)
                if yaml_match:
                    return {"cloudformation_yaml": yaml_match.group(1).strip()}
            else:
                mermaid_match = re.search(r"```(?:mermaid)?\n([\s\S]*?)```", combined_text, re.IGNORECASE)
                if mermaid_match:
                    return {"mermaid_code": mermaid_match.group(1).strip()}

            return {"error": f"Bedrock returned text instead of tool call: {combined_text[:400]}"}

        # Return an error if Claude didn't use the required tool and no text fallback exists
        return {"error": "Bedrock did not return a tool call or text response"}

    except Exception as e:
        # Catch and return any API or validation errors
        return {"error": str(e)}