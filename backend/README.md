# Cloud Weaver Backend

Backend services for Cloud Weaver.

This backend is being built as a serverless workflow that takes a user prompt,
uses Amazon Bedrock to generate Mermaid architecture diagrams, and validates the
result before deployment-related work continues.

## Overview

The backend currently centers around two pieces of functionality:

- **Diagram generation**
  - AWS Lambda acts as the main entry point for incoming requests.
  - API Gateway WebSockets are intended to route messages to the Lambda handler.
  - Amazon Bedrock is used through `boto3` to generate Mermaid JS output from
    the user's prompt.
- **Validation**
  - Mermaid syntax is checked first so malformed diagrams can be rejected early.
  - Architecture rules are then applied to ensure only approved AWS services are
    used and that the selected services are connected in a valid way.

## Architecture

- **AWS Lambda**: The main entry point (`lambda/handler.py`), designed to be
  triggered by API Gateway WebSockets. It routes incoming messages and builds
  the AI prompt.
- **Amazon Bedrock**: Uses Claude Opus 4.5 via the `boto3` client
  (`lambda/bedrock_client.py`) to process the prompt and strictly output a valid
  Mermaid JS diagram using a JSON tool schema.

## Validation modules

- `validation/architecture_rules.py`
  - Enforces the approved-service allowlist.
  - Checks that at least one approved service is selected.
  - Flags duplicate connections.
  - Warns about orphan services and connections that reference services outside
    the selected set.
- `validation/mermaid_syntax.py`
  - Performs lightweight Mermaid formatting checks.
  - Validates the header format (`graph` / `flowchart` + direction).
  - Checks delimiter and quote balance.
  - Warns on minimal diagrams and missing visible edges.

## Setup

From the `backend/` folder:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### AWS credentials

Make sure your local environment has AWS credentials configured before testing
Bedrock or other AWS service integrations:

```bash
aws configure
```

You will also need permission to invoke the Bedrock model available in your
chosen AWS region.

### Local testing

If your branch includes the Lambda test harness, you can mock a WebSocket
payload and test the Bedrock response locally:

```bash
cd lambda
python3 test_local.py
```

## Dependencies

- `boto3` — AWS SDK for Bedrock, DynamoDB, STS, and CloudFormation
- `PyYAML` — YAML handling for CloudFormation template composition
- `cfn-lint` — CloudFormation template validation and linting
- `pytest` — Testing

## Project structure

- `validation/`
  - `__init__.py`
  - `architecture_rules.py`
  - `mermaid_syntax.py`
- `requirements.txt`
- `.gitignore`
- `lambda/` *(planned / branch-specific, if present)*
  - `handler.py`
  - `bedrock_client.py`
  - `test_local.py`

## Current status

- Python backend scaffolded
- Validation package created in `validation/`
- Architecture rules validator added
- Mermaid syntax validator added
- Backend `.gitignore` and `requirements.txt` added
- README updated to reflect current validation and Bedrock workflow

## Notes

- Keep the virtual environment in `backend/.venv`.
- Do not commit secrets (`.env`, keys, credentials`).
- This README will continue to expand as Lambda handlers, deployment logic, and additional validation steps are added.
