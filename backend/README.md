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
# Backend

Backend validation and deployment logic for project.

## Current status

- Python backend scaffolded
- Validation package created in `validation/`
- Architecture rules validator added
- Mermaid syntax validator added
- Backend `.gitignore` and `requirements.txt` added

## Validation modules (so far)

- `validation/architecture_rules.py`
  - Enforces approved-service allowlist
  - Checks minimum service selection
  - Flags duplicate connections
  - Warns on orphan services and connection references not in selected services

- `validation/mermaid_syntax.py`
  - Performs lightweight Mermaid formatting checks
  - Validates diagram header (`graph`/`flowchart` + direction)
  - Checks delimiter/quote balance
  - Warns on minimal diagrams and missing visible edges

## Setup

From the `backend/` folder:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Dependencies

- `boto3` (AWS APIs)
- `PyYAML` (YAML handling)
- `cfn-lint` (CloudFormation linting)
- `pytest` (testing)

## Folder structure

- `validation/`
  - `__init__.py`
  - `architecture_rules.py`
  - `mermaid_syntax.py`
- `requirements.txt`
- `.gitignore`

## Notes

- Keep the virtual environment in `backend/.venv`
- Do not commit secrets (`.env`, keys, credentials)
- This README is intentionally concise and will be expanded as API/Lambda handlers are added
