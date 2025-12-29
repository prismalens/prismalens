"""
Standardized result interface for @FunctionTool functions.
"""

from typing import Any


def create_tool_result(
    status: str,
    message: str,
    data: dict[str, Any] | None = None,
    confidence: float = 1.0,
) -> dict[str, Any]:
    """
    Create standardized result for all @FunctionTool functions.

    This function ensures consistent return format across all tools,
    making it easier for agents to parse and understand tool outputs.

    Args:
        status: Status string - "success", "error", "warning", "pending", etc.
        message: Human-readable description of the result
        data: Optional dictionary containing result data
        confidence: Confidence score from 0.0 to 1.0 (default: 1.0)

    Returns:
        Standardized result dictionary with status, message, confidence,
        and optional data fields.

    Example:
        >>> create_tool_result(
        ...     status="success",
        ...     message="Alert validated successfully",
        ...     data={"alert_id": "123", "severity": "high"},
        ...     confidence=0.95
        ... )
        {
            "status": "success",
            "message": "Alert validated successfully",
            "confidence": 0.95,
            "data": {"alert_id": "123", "severity": "high"}
        }
    """
    result: dict[str, Any] = {
        "status": status,
        "message": message,
        "confidence": confidence,
    }
    if data is not None:
        result["data"] = data
    return result
