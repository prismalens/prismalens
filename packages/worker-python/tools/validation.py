"""
Validation tools for PrismaLens Worker.

This module contains alert validation and data extraction tools.
"""

import logging
from typing import Any

from google.adk.tools import FunctionTool, ToolContext

from config.settings import settings
from utils.tool_utils import create_tool_result

logger = logging.getLogger(__name__)


@FunctionTool
def validate_alert_data(alert_payload: dict) -> dict:
    """
    Basic validation of incoming alert data.

    Args:
        alert_payload: Raw alert data from monitoring system

    Returns:
        Validation result
    """
    try:
        issues = []

        # Check required fields
        required_fields = ["alertname"]
        for field in required_fields:
            if not alert_payload.get(field):
                issues.append(f"Missing required field: {field}")

        status = "valid" if not issues else "invalid"

        logger.info(f"Alert validation: {status} ({len(issues)} issues)")

        return create_tool_result(
            status=status,
            message=f"Alert validation: {status} ({len(issues)} issues)",
            data={"issues": issues},
            confidence=1.0 if status == "valid" else 0.0,
        )

    except Exception as e:
        logger.error(f"Validation failed: {e}")
        return create_tool_result(
            status="error",
            message=f"Validation error: {str(e)}",
            data={"issues": [f"Validation error: {str(e)}"]},
            confidence=0.0,
        )


@FunctionTool
def normalize_alert_format(alert_data: dict) -> dict:
    """
    Basic alert normalization for consistent processing.

    Args:
        alert_data: Raw alert data

    Returns:
        Normalized alert data
    """
    try:
        normalized = {
            "alertname": alert_data.get("alertname", "unknown"),
            "status": alert_data.get("status", "firing"),
            "severity": alert_data.get(
                "severity", alert_data.get("labels", {}).get("severity", "medium")
            ),
            "timestamp": alert_data.get(
                "timestamp", alert_data.get("startsAt", "unknown")
            ),
            "labels": alert_data.get("labels", {}),
            "annotations": alert_data.get("annotations", {}),
            "service": alert_data.get(
                "service", alert_data.get("labels", {}).get("service", "unknown")
            ),
        }

        logger.info(f"Normalized alert: {normalized['alertname']}")

        return create_tool_result(
            status="normalized",
            message=f"Normalized alert: {normalized['alertname']}",
            data={"normalized_alert": normalized},
        )

    except Exception as e:
        logger.error(f"Normalization failed: {e}")
        return create_tool_result(
            status="error",
            message=f"Normalization failed: {str(e)}",
            confidence=0.0,
        )


@FunctionTool
def extract_service_info(tool_context: ToolContext, alert_data: dict) -> dict:
    """
    Extract service and repository information from alert.

    Args:
        tool_context: Tool context with session state access
        alert_data: Alert data

    Returns:
        Service information
    """
    try:
        # Extract service name from various possible fields
        service_name = (
            alert_data.get("service")
            or alert_data.get("labels", {}).get("service")
            or alert_data.get("labels", {}).get("job")
            or alert_data.get("labels", {}).get("app")
            or "unknown"
        )

        # Map service to repository name
        repository_name = _map_service_to_repository(service_name)

        tool_context.state["repository_name"] = repository_name
        tool_context.state["service_name"] = service_name

        logger.info(
            f"Extracted service: {service_name} -> repository: {repository_name}"
        )

        return create_tool_result(
            status="extracted",
            message=f"Extracted service: {service_name} -> repository: {repository_name}",
            data={"service_name": service_name, "repository_name": repository_name},
        )

    except Exception as e:
        logger.error(f"Service extraction failed: {e}")
        return create_tool_result(
            status="error",
            message=f"Normalization failed: {str(e)}",
            confidence=0.0,
        )


@FunctionTool
def extract_alert_metadata(tool_context: ToolContext, alert_data: dict) -> dict:
    """
    Extract key metadata from alert for analysis.

    Args:
        tool_context: Tool context with session state access
        alert_data: Alert data

    Returns:
        Extracted metadata
    """
    try:
        # Extract error type from alert text
        error_type = _extract_error_type(alert_data)

        # Update session state
        tool_context.state["error_type"] = error_type

        logger.info(f"Extracted error type: {error_type}")

        return create_tool_result(
            status="extracted",
            message=f"Extracted error type: {error_type}",
            data={"error_type": error_type},
        )

    except Exception as e:
        logger.error(f"Metadata extraction failed: {e}")
        return create_tool_result(
            status="error",
            message=f"Normalization failed: {str(e)}",
            confidence=0.0,
        )


def _map_service_to_repository(service_name: str) -> str:
    """Map service name to repository name."""

    # Normalize service name
    normalized_service = service_name.lower().strip()

    # Try exact match from settings
    if (
        hasattr(settings, "service_repo_mapping")
        and normalized_service in settings.service_repo_mapping
    ):
        return settings.service_repo_mapping[normalized_service]

    # Default: use service name as repository name
    return normalized_service


def _extract_error_type(alert_data: dict) -> str:
    """Extract error type from alert content."""

    # Combine text fields for analysis
    text_fields = [
        alert_data.get("alertname", ""),
        alert_data.get("annotations", {}).get("summary", ""),
        alert_data.get("annotations", {}).get("description", ""),
    ]

    combined_text = " ".join(text_fields).lower()

    # Error pattern matching
    if "timeout" in combined_text or "timed out" in combined_text:
        return "timeout"
    elif "connection" in combined_text:
        return "connection_error"
    elif "memory" in combined_text or "oom" in combined_text:
        return "memory_issue"
    elif "database" in combined_text or "db" in combined_text:
        return "database_error"
    elif "http" in combined_text and ("5" in combined_text or "4" in combined_text):
        return "http_error"
    elif "disk" in combined_text or "storage" in combined_text:
        return "disk_issue"
    elif "cpu" in combined_text:
        return "cpu_issue"
    else:
        return "unknown"
