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
    """


def _construct_unknown_tag(loader: _CloudFormationLoader, _: str, node: yaml.Node):
    """Gracefully parse unknown YAML tags as native Python values."""

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

    if not template_text or not template_text.strip():
        errors.append(
            {
                "rule": "empty_template",
                "message": "CloudFormation template is empty.",
            }
        )
        return {"passed": False, "errors": errors, "warnings": warnings}

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

    if not isinstance(parsed, dict):
        errors.append(
            {
                "rule": "template_root",
                "message": "Template root must be a YAML mapping/object.",
            }
        )
        return {"passed": False, "errors": errors, "warnings": warnings}

    resources = parsed.get("Resources")
    if not isinstance(resources, dict) or not resources:
        errors.append(
            {
                "rule": "resources_required",
                "message": "Template must include a non-empty 'Resources' mapping.",
            }
        )
    else:
        for logical_id, resource in resources.items():
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

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
