# Backend

Backend services

## What we have so far

- Python backend structure initialized
- `validation/architecture_rules.py` added for **architecture rule validation**
- `.gitignore` configured for Python/Lambda development
- `requirements.txt` added for shared backend dependencies

## Tech (backend)

- Python 3.12
- AWS SDK (`boto3`)
- YAML processing (`PyYAML`)
- CloudFormation linting (`cfn-lint`)
- Testing (`pytest`)

## Setup

From the `backend/` folder:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Current folder structure

- `validation/` – validation pipeline logic
  - `architecture_rules.py` – hard-coded architecture validation rules
- `requirements.txt` – shared backend dependencies
- `.gitignore` – ignores venv, caches, build artifacts, etc.

## Notes

- Keep the virtual environment in `backend/.venv`
- Do not commit secrets (`.env`, credentials, keys)
- README is intentionally minimal for now and will be expanded as features land