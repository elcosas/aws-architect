"""Architecture validation rules for Mermaid-generated AWS diagrams.

This module performs fast, deterministic validation using a strict service
allowlist. It is designed to run before any LLM-based validation so users get
immediate feedback on obvious issues.

Validation goals:
1. Ensure at least one service is selected.
2. Ensure only approved services are used.
3. Detect duplicate directed connections (same ``from -> to`` more than once).
4. Warn when a selected service is not connected.
5. Warn when a connection references services outside the selected list.
"""

from __future__ import annotations

from collections import Counter
from typing import NotRequired, TypedDict


class Connection(TypedDict):
    """Represents one Mermaid edge in normalized API payload form.

    Keys:
        from: Source service name.
        to: Target service name.
        label: Optional edge label shown in Mermaid.
    """

    from_: str
    to: str
    label: NotRequired[str]


class ValidationIssue(TypedDict):
    """A single validation error or warning."""

    rule: str
    message: str


class ValidationResult(TypedDict):
    """Top-level architecture validation response."""

    passed: bool
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]


# Canonical list of services allowed in ArcForge v1 architectures.
ALLOWED_SERVICES = {
    "S3",
    "Lambda",
    "EC2",
    "Bedrock",
    "SNS",
    "API Gateway",
}


# Aliases normalize common casing/spelling variants from prompts/Mermaid nodes.
SERVICE_ALIASES = {
    "s3": "S3",
    "lambda": "Lambda",
    "ec2": "EC2",
    "bedrock": "Bedrock",
    "amazon bedrock": "Bedrock",
    "sns": "SNS",
    "api gateway": "API Gateway",
    "apigateway": "API Gateway",
    "api-gateway": "API Gateway",
}


def _normalize_service_name(service_name: str) -> str:
    """Normalize service names to canonical values used by the validator.

    Normalization rules:
    - Trim surrounding whitespace.
    - Convert known aliases (case-insensitive) to canonical names.
    - Return an empty string when input is blank.
    """

    raw = service_name.strip()
    if not raw:
        return ""
    return SERVICE_ALIASES.get(raw.lower(), raw)


def validate_architecture_rules(services: list[str], connections: list[dict]) -> ValidationResult:
    """Validate selected services and Mermaid connections against project rules.

    Args:
        services: Selected service names, e.g. ["S3", "Lambda", "API Gateway"].
        connections: Connection dictionaries containing ``from`` and ``to`` keys
            (and optional ``label``). Example:
            [{"from": "API Gateway", "to": "Lambda", "label": "invoke"}]

    Returns:
        A dictionary with:
        - ``passed``: ``True`` when no errors are present.
        - ``errors``: Blocking issues that should fail validation.
        - ``warnings``: Non-blocking issues to surface in chat feedback.
    """

    normalized_services = [_normalize_service_name(service) for service in services]
    service_set = set(normalized_services)
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    if not service_set:
        errors.append(
            {
                "rule": "minimum_services",
                "message": "Architecture must include at least one approved service.",
            }
        )

    unsupported_services = sorted(service_name for service_name in service_set if service_name not in ALLOWED_SERVICES)
    if unsupported_services:
        errors.append(
            {
                "rule": "allowed_services",
                "message": (
                    "Only approved services are allowed: "
                    f"{', '.join(sorted(ALLOWED_SERVICES))}. "
                    f"Found unsupported services: {', '.join(unsupported_services)}."
                ),
            }
        )

    # Count directed edges so repeated links can be flagged.
    connection_counts = Counter()
    connected_services: set[str] = set()

    for connection in connections:
        # ``from`` is a Python keyword in type declarations, but valid as a dict
        # key in runtime payloads.
        source = _normalize_service_name(str(connection.get("from", "")))
        target = _normalize_service_name(str(connection.get("to", "")))

        if source:
            connected_services.add(source)
        if target:
            connected_services.add(target)

        if source and target:
            connection_counts[(source, target)] += 1

        if source and source not in service_set:
            warnings.append(
                {
                    "rule": "connection_reference",
                    "message": f"Connection source '{source}' is not in selected services.",
                }
            )

        if target and target not in service_set:
            warnings.append(
                {
                    "rule": "connection_reference",
                    "message": f"Connection target '{target}' is not in selected services.",
                }
            )

    for source_target, count in connection_counts.items():
        if count > 1:
            source, target = source_target
            errors.append(
                {
                    "rule": "duplicate_connection",
                    "message": f"Duplicate connection detected for {source} -> {target}.",
                }
            )

    for service_name in sorted(service_set):
        if service_name not in connected_services:
            warnings.append(
                {
                    "rule": "orphan",
                    "message": f"{service_name} is not connected to anything.",
                }
            )

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
