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