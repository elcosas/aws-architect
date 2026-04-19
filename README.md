# Cloud Weaver

Cloud Weaver is an AI-powered AWS architecture assistant that turns a user's
plain-English project idea into an AWS architecture diagram, validates it, and
prepares the output for deployment-oriented workflows.

## How it works

1. A user types a project idea into the frontend chat UI.
2. The frontend sends that prompt to the backend through API Gateway.
3. The backend sends the prompt to Amazon Bedrock (Claude).
4. Bedrock returns Mermaid diagram text describing the proposed architecture.
5. The backend validates the Mermaid syntax and CloudFormation/template output.
6. The validated result is returned to the frontend for display.
7. The user can review the architecture and continue toward deployment.

## Architecture structure

- **Frontend**
	- React + Vite chat application
	- Renders assistant responses and Mermaid diagrams
	- Hosted separately behind S3 + CloudFront
- **Backend**
	- Python Lambda functions
	- Receives user prompts from API Gateway
	- Calls Bedrock for diagram generation
	- Runs syntax/structure validators before returning results
- **Validation layer**
	- Mermaid syntax validation
	- CloudFormation YAML validation
	- Architecture rule validation for approved services

## AWS services users get to use

These are the predefined AWS services the user can select for generated
architectures:

- **S3** — Object storage used when an architecture needs file storage,
	static assets, or simple durable buckets.
- **Lambda** — Serverless compute used to run backend logic without managing
	servers.
- **EC2** — Virtual machine compute for workloads that need direct server
	control or custom runtimes.
- **Bedrock** — Managed foundation model access that powers AI generation for
	architecture ideas and Mermaid output.
- **SNS** — Pub/sub notification service used for fan-out messaging and event
	notifications.
- **API Gateway** — Front door for APIs that lets clients send requests to
	backend services in a controlled way.

## AWS services used to build this application

These are the AWS services used internally to power the application itself:

- **IAM** — Controls access and permissions for AWS resources used by the app.
	It keeps each service limited to only the actions it needs.
- **S3** — Stores frontend build assets and can also be used for generated
	artifacts or deployment files.
- **Lambda** — Runs the backend handlers that receive prompts, call Bedrock,
	and return validated results.
- **CloudFormation** — Defines infrastructure as code so the backend and other
	AWS resources can be provisioned consistently.
- **CloudFront** — Serves the frontend quickly through a CDN in front of S3.
- **Bedrock** — Provides the Claude model used to turn user prompts into
	Mermaid architecture output.
- **DynamoDB** — Stores lightweight app/session data when persistent state is
	needed.
- **API Gateway** — Receives frontend requests and forwards them to Lambda.

## Current focus

- Generating architecture diagrams from user prompts
- Validating Mermaid and CloudFormation output
- Returning clean feedback to the user before deployment steps

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
