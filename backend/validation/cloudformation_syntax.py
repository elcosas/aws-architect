"""Lightweight CloudFormation YAML validation utilities.

This module provides a fast, deterministic first-pass validator for generated
CloudFormation templates. It focuses on template-level syntax and basic shape,
so callers can fail early before deeper semantic checks or deployment.
"""

from __future__ import annotations

from typing import TypedDict

import yaml


class ValidationIssue(TypedDict):
    """A single validation issue returned by the CloudFormation validator."""

    rule: str
    message: str


class ValidationResult(TypedDict):
    """Top-level CloudFormation validation response."""

    passed: bool
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]


class _CloudFormationLoader(yaml.SafeLoader):
    """YAML loader that tolerates CloudFormation intrinsic tags.

    CloudFormation templates commonly use custom tags like ``!Ref`` and ``!Sub``
    that a strict YAML loader does not recognize by default.

    This class intentionally has no custom attributes or methods. It acts as a
    dedicated loader type so we can attach CloudFormation-specific tag handling
    (via ``add_multi_constructor``) without mutating ``yaml.SafeLoader``
    globally for other YAML parsing code.
    """

    pass


def _construct_unknown_tag(loader: _CloudFormationLoader, _: str, node: yaml.Node):
    """Gracefully parse unknown CloudFormation-style YAML tags.

    For tags like ``!Ref`` or ``!Sub``, this constructor falls back to building
    a normal Python scalar, sequence, or mapping so syntax validation can still
    run even when custom tags are present.
    """

    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    return None


_CloudFormationLoader.add_multi_constructor("!", _construct_unknown_tag)


def validate_cloudformation_syntax(template_text: str) -> ValidationResult:
    """Validate CloudFormation YAML syntax and base structure.

    Args:
        template_text: Raw CloudFormation YAML text.

    Returns:
        A dictionary with:
        - ``passed``: ``True`` when no blocking errors are present.
        - ``errors``: Syntax or structure issues that should block progression.
        - ``warnings``: Non-blocking issues to surface in chat feedback.
    """

    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    # 1) Guardrail: template text must exist.
    if not template_text or not template_text.strip():
        errors.append(
            {
                "rule": "empty_template",
                "message": "CloudFormation template is empty.",
            }
        )
        return {"passed": False, "errors": errors, "warnings": warnings}

    # 2) Parse YAML using the CloudFormation-aware loader.
    try:
        parsed = yaml.load(template_text, Loader=_CloudFormationLoader)
    except yaml.YAMLError as exc:
        errors.append(
            {
                "rule": "yaml_syntax",
                "message": f"Invalid YAML syntax: {exc}",
            }
        )
        return {"passed": False, "errors": errors, "warnings": warnings}

    # 3) Root must be a mapping/object for valid CloudFormation templates.
    if not isinstance(parsed, dict):
        errors.append(
            {
                "rule": "template_root",
                "message": "Template root must be a YAML mapping/object.",
            }
        )
        return {"passed": False, "errors": errors, "warnings": warnings}

    # 4) Resources section is required and must be a non-empty mapping.
    resources_section = parsed.get("Resources")
    if not isinstance(resources_section, dict) or not resources_section:
        errors.append(
            {
                "rule": "resources_required",
                "message": "Template must include a non-empty 'Resources' mapping.",
            }
        )
    else:
        # 5) Each declared resource must be an object and include a valid Type.
        for logical_id, resource in resources_section.items():
            if not isinstance(resource, dict):
                errors.append(
                    {
                        "rule": "resource_format",
                        "message": f"Resource '{logical_id}' must be a mapping/object.",
                    }
                )
                continue

            resource_type = resource.get("Type")
            if not isinstance(resource_type, str) or not resource_type.strip():
                errors.append(
                    {
                        "rule": "resource_type",
                        "message": f"Resource '{logical_id}' is missing a valid 'Type' field.",
                    }
                )

    # 6) Final pass/fail is based on whether blocking errors were found.
    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
