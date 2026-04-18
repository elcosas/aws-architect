"""Hard-coded validation rules for architecture suggestions."""

from __future__ import annotations
from collections import Counter


def _normalize_service_name(service_name: str) -> str:
    return service_name.strip()


def validate_architecture_rules(services: list[str], connections: list[dict]) -> dict:
    """Validate selected services and connections against hard-coded rules.

    Args:
        services: List of service names, e.g. ["S3", "Lambda", "DynamoDB"]
        connections: List of dicts with "from", "to", "label" keys

    Returns:
        {
            "passed": bool,
            "errors": [{"rule": "dependency", "message": "API Gateway requires Lambda..."}],
            "warnings": [{"rule": "orphan", "message": "S3 is not connected to anything"}]
        }
    """

    normalized_services = [_normalize_service_name(service) for service in services]
    service_set = set(normalized_services)
    errors: list[dict] = []
    warnings: list[dict] = []

    required_dependencies = {
        "API Gateway": ["Lambda"],
        "CloudFront": ["S3"],
        "SQS": ["Lambda"],
        "SNS": ["Lambda"],
    }

    invalid_connections = {
        ("CloudFront", "DynamoDB"),
        ("SQS", "API Gateway"),
        ("SNS", "DynamoDB"),
        ("S3", "API Gateway"),
        ("CloudFront", "Lambda"),
    }

    for service_name, dependencies in required_dependencies.items():
        if service_name in service_set:
            missing_dependencies = [dependency for dependency in dependencies if dependency not in service_set]
            if missing_dependencies:
                dependency_list = ", ".join(missing_dependencies)
                errors.append(
                    {
                        "rule": "dependency",
                        "message": f"{service_name} requires {dependency_list} to be present.",
                    }
                )

    if "Lambda" not in service_set:
        errors.append(
            {
                "rule": "compute",
                "message": "Every architecture must include at least one compute service: Lambda.",
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

        connection_counts[(source, target)] += 1

        if (source, target) in invalid_connections:
            errors.append(
                {
                    "rule": "invalid_connection",
                    "message": f"{source} should not connect directly to {target}.",
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

    for service_name in normalized_services:
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
