# Cloud Weaver

![Cloud Weaver Wallpaper](docs/images/wallpaper.png)

Cloud Weaver is an AI-powered AWS architecture assistant that turns a user's
plain-English project idea into an AWS architecture diagram, validates it, and
prepares the output for deployment-oriented workflows.

Cloudfront URL (Frontend): https://d2k45vy1qt3ioe.cloudfront.net/
API Gateway (Backend): wss://9vihcpxj86.execute-api.us-west-2.amazonaws.com/dev/

## How it works

1. A user types a project idea into the frontend chat UI.
2. The frontend sends that prompt to the backend through API Gateway.
3. The backend sends the prompt to Amazon Bedrock (Claude).
4. Bedrock returns Mermaid diagram text plus architecture reasoning.
5. The backend normalizes and validates Mermaid output, enforces selected-service constraints, and stores chat/session history in DynamoDB.
6. The result is returned to the frontend over WebSocket for rendering.
7. The user can approve the architecture and request CloudFormation generation using the latest assistant context from the same session.

## Architecture structure

- **Frontend**
	- React + Vite chat application
	- Renders assistant responses and Mermaid diagrams
	- Hosted separately behind S3 + CloudFront
- **Backend**
	- Python Lambda functions
	- Receives user prompts from API Gateway WebSocket routes
	- Calls Bedrock for diagram generation
	- Persists session and message history in DynamoDB for multi-turn memory
	- Runs syntax/structure validators and returns reasoning + diagram
- **Validation layer**
	- Mermaid syntax validation
	- CloudFormation YAML validation
	- Architecture rule validation for approved services

## AWS services users get to use

These are the predefined AWS services the user can select for generated
architectures:

- **Amazon Bedrock**
- **AWS Lambda**
- **Amazon S3**
- **API Gateway**
- **CloudFront**
- **CloudFormation**
- **DynamoDB**
- **AWS IAM**

## AWS services used to build this application

![Cloud Weaver Architecture Diagram](docs/images/architecture-diagram.png)

These are the AWS services used internally to power the application itself:

- **API Gateway (WebSocket)** — Real-time chat transport between frontend and Lambda.
- **Lambda** — Backend orchestration, prompt handling, validation, and session-aware routing.
- **Bedrock** — LLM inference for Mermaid architecture and CloudFormation generation.
- **DynamoDB** — Persistent chat memory/session storage.
  - Sessions table (current env): `Sessions`
  - Messages table (current env): `Messages`
  - TTL attribute used by app: `expiresAt`
- **S3** — Frontend artifact storage and prompts sync target during deploy.
- **CloudFront** — CDN for frontend delivery and cache invalidation on release.
- **CloudFormation** — Infrastructure-as-code output generated from approved diagrams.
- **IAM** — Execution/deployment permissions for Lambda, API access, and CI pipeline.
- **STS** — Identity verification and temporary credentials in deployment workflows.

## Session memory (ChatGPT-like behavior)

Cloud Weaver uses `sessionID` to maintain multi-turn context.

- Frontend stores `sessionID` in browser localStorage and sends it with each request.
- Backend loads recent history from DynamoDB and includes it in Bedrock prompts.
- CloudFormation generation uses the latest assistant architecture context from the same session.

Current Lambda environment variables:

- `CHAT_HISTORY_LIMIT=20`
- `MESSAGES_TABLE=Messages`
- `SESSION_TABLE=Sessions`
- `SESSION_TTL_SECONDS=604800`

Note: backend supports both `SESSION_TABLE` and `SESSIONS_TABLE` env var names.


## Current focus

- Generating architecture diagrams from user prompts
- Maintaining session-aware chat memory with DynamoDB
- Validating Mermaid and CloudFormation output
- Returning architecture reasoning and clean feedback before deployment steps

## Getting started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If you need a clean reinstall for the frontend after pulling changes:

```bash
cd frontend
rm -rf node_modules
npm ci
```
