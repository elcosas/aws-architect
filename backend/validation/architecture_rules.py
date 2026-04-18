"""Hard-coded validation rules for architecture suggestions."""

from __future__ import annotations
from collections import Counter


ALLOWED_SERVICES = {
    "S3",
    "Lambda",
    "EC2",
    "Bedrock",
    "SNS",
    "API Gateway",
}


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
    raw = service_name.strip()
    if not raw:
        return ""
    return SERVICE_ALIASES.get(raw.lower(), raw)


def validate_architecture_rules(services: list[str], connections: list[dict]) -> dict:
    """Validate selected services and Mermaid connections against project rules.

    Args:
        services: List of service names, e.g. ["S3", "Lambda", "API Gateway"]
        connections: List of dicts with "from", "to", "label" keys

    Returns:
        {
            "passed": bool,
            "errors": [{"rule": "allowed_services", "message": "Only approved services may be used..."}],
            "warnings": [{"rule": "orphan", "message": "S3 is not connected to anything"}]
        }
    """

    normalized_services = [_normalize_service_name(service) for service in services]
    service_set = set(normalized_services)
    errors: list[dict] = []
    warnings: list[dict] = []

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

    connection_counts = Counter()
    connected_services: set[str] = set()

    for connection in connections:
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
