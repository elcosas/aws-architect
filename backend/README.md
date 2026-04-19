# AWS-Architect Backend

Backend services for ArcForge / AWS-Architect.
This backend receives a user project idea from the frontend through API Gateway,
calls Amazon Bedrock to generate a Mermaid architecture diagram, validates the
diagram and later CloudFormation output, and returns structured results to the
## Folder structure

```text
backend/
├── README.md
├── requirements.txt
├── lambda/
│   ├── bedrock_client.py
│   ├── cfn-prompt.txt
│   ├── handler.py
│   ├── system-prompt.txt
│   └── test_local.py
└── validation/
  ├── __init__.py
  ├── architecture_rules.py
  ├── cloudformation_syntax.py
  └── mermaid_syntax.py
```

## Overview

The backend is organized around three main responsibilities:
- **Prompt handling and orchestration**
  - `lambda/handler.py` is the API Gateway Lambda entry point.
  - It reads request payloads, builds prompts, and routes requests for diagram
    generation or CloudFormation generation.
- **Bedrock integration**
  - `lambda/bedrock_client.py` calls Amazon Bedrock using `boto3`.
  - The Bedrock model is configured to return structured output for Mermaid or
    CloudFormation generation.
- **Validation**
  - `validation/mermaid_syntax.py` checks Mermaid text formatting.
  - `validation/architecture_rules.py` checks allowed AWS services and diagram
    connections.
  - `validation/cloudformation_syntax.py` checks CloudFormation YAML syntax and
    required structure.

## Current flow

1. The frontend sends a user idea to API Gateway.
2. `lambda/handler.py` receives the event and extracts the user input.
3. The handler sends the prompt to `lambda/bedrock_client.py`.
4. Bedrock returns Mermaid text for the proposed AWS architecture.
5. Mermaid output is validated with `validation/mermaid_syntax.py`.
6. The architecture is validated with `validation/architecture_rules.py`.
7. If the diagram is approved, the backend can continue to CloudFormation
  generation using `lambda/cfn-prompt.txt` and `validation/cloudformation_syntax.py`.
8. CloudFormation output is validated before deployment-related steps continue.

## Validation modules

### `validation/mermaid_syntax.py`

Performs lightweight Mermaid formatting checks:

- verifies the diagram header (`graph` / `flowchart` + direction)
- checks for empty or minimal diagrams
- checks delimiter and quote balance
- warns when there are no visible connections

### `validation/architecture_rules.py`

Checks generated architectures against the approved service model:

- allows only the approved service set (`S3`, `Lambda`, `EC2`, `Bedrock`,
  `SNS`, `API Gateway`)
- normalizes common service aliases
- flags duplicate connections
- warns about orphan services
- warns when a connection references services outside the selected set

### `validation/cloudformation_syntax.py`

Validates generated CloudFormation YAML:

- rejects empty templates
- validates YAML syntax using a CloudFormation-aware loader
- verifies the root object is a mapping
- requires a non-empty `Resources` mapping
- verifies each resource is a mapping with a valid `Type`

## Bedrock prompts

- `lambda/system-prompt.txt` defines the architecture-generation rules for the
  Mermaid step.
- `lambda/cfn-prompt.txt` defines the CloudFormation generation rules for the
  approved diagram.

## Setup

From the `backend/` folder:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Local testing

If the Lambda test harness is present, you can run the backend locally:

```bash
cd lambda
python3 test_local.py
```

The local test script currently simulates both:

- Mermaid diagram generation from a sample user idea
- CloudFormation generation from an approved diagram

## Dependencies

- `boto3` — AWS SDK used for Bedrock and other AWS service integrations
- `PyYAML` — YAML parsing for CloudFormation validation
- `cfn-lint` — optional CloudFormation linting support
- `pytest` — testing support

## Notes

- Keep the virtual environment in `backend/.venv`.
- Do not commit secrets, credentials, or `.env` files.
- This backend is still evolving, so the README should be updated whenever new
  Lambda routes, validation rules, or deployment steps are added.
# AWS-Architect Backend

Backend services for ArcForge / AWS-Architect.

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
