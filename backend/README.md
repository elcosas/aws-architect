# AWS-Architect Backend

A serverless backend built with AWS Lambda and Amazon Bedrock that generates Mermaid JS architecture diagrams based on user prompts and selected AWS services.

## Architecture

- **AWS Lambda**: The main entry point (`lambda/handler.py`), designed to be triggered by API Gateway WebSockets. It routes incoming messages and constructs the AI prompt.
- **Amazon Bedrock**: Uses Claude Opus 4.5 via the `boto3` client (`lambda/bedrock_client.py`) to process the prompt and strictly output a valid Mermaid JS diagram using a JSON tool schema.

## Setup Instructions

1. **Install Dependencies**
   The only external dependency is `boto3`, used to communicate with Bedrock.
   ```bash
   pip install -r requirements.txt
   ```
   *(Note: AWS Lambda includes `boto3` by default, but it is required for local testing).*

2. **Configure AWS Credentials**
   Ensure your local environment has active AWS credentials configured (`aws configure`) with permissions to invoke Amazon Bedrock models in your chosen region.

3. **Local Testing**
   You can mock a WebSocket payload and quickly test the Bedrock response locally:
   ```bash
   cd lambda
   python3 test_local.py
   ```