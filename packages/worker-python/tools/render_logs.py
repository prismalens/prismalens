"""
Render.com Function Tools for PrismaLens Worker.

Log fetching from Render.com deployed services.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from google.adk.tools import FunctionTool

from config.settings import settings
from utils.tool_utils import create_tool_result

logger = logging.getLogger(__name__)


@FunctionTool
def get_render_logs(
    time_range_minutes: int = 60,
    limit: int = 100,
    search_query: Optional[str] = None,
) -> dict:
    """
    Fetch logs from Render.com service for alert analysis.

    Args:
        time_range_minutes: How many minutes back to fetch logs (default: 60)
        limit: Maximum number of log logs to return (default: 100)
        search_query: Optional search query to filter logs

    Returns:
        Logs data with logs and metadata
    """
    logger.info(f"Fetching render logs: {time_range_minutes}min range, limit={limit}")
    if search_query:
        logger.info(f"   Search query: '{search_query}'")

    result = _get_render_logs(
        time_range_minutes=time_range_minutes, limit=limit, search_query=search_query
    )

    if result.get("status") == "success":
        logs_count = len(result.get("logs", {}).get("logs", []))
        logger.info(f"Fetched {logs_count} log logs")
    else:
        logger.warning(f"Log fetch failed: {result.get('error', 'unknown error')}")

    return result


@FunctionTool
def get_render_logs_around_time(
    target_time: str, window_minutes: int = 15, limit: int = 100
) -> dict:
    """
    Get logs around a specific time (useful for alert correlation).

    Args:
        target_time: Target timestamp in ISO format (e.g., alert timestamp)
        window_minutes: Minutes before and after target time (default: 15)
        limit: Maximum number of log logs to return

    Returns:
        Logs around the specified time
    """
    try:
        # Parse target time
        try:
            target_dt = datetime.fromisoformat(target_time.replace("Z", "+00:00"))
        except ValueError:
            return create_tool_result(
                status="error",
                message=f"Invalid timestamp format: {target_time}. Use ISO format.",
                confidence=0.0,
            )

        # Get logs from around the target time
        result = _get_render_logs(
            time_range_minutes=window_minutes * 2,  # Total window
            limit=limit,
            target_time=target_time,
        )

        if result["status"] != "success":
            return result

        logs = result["logs"]["logs"]

        # Filter logs to the time window around target
        start_time = target_dt - timedelta(minutes=window_minutes)
        end_time = target_dt + timedelta(minutes=window_minutes)

        filtered_logs = []
        for log in logs:
            try:
                log_time = datetime.fromisoformat(
                    log["timestamp"].replace("Z", "+00:00")
                )
                if start_time <= log_time <= end_time:
                    # Add time difference from target
                    time_diff = (log_time - target_dt).total_seconds()
                    log["time_diff_seconds"] = time_diff
                    filtered_logs.append(log)
            except (KeyError, ValueError):
                continue

        # Sort by proximity to target time
        filtered_logs.sort(key=lambda x: abs(x.get("time_diff_seconds", 0)))

        return create_tool_result(
            status="success",
            message=f"Found {len(filtered_logs)} logs around target time",
            data={
                "logs_around_alert": {
                    "logs": filtered_logs,
                    "target_time": target_time,
                    "window_minutes": window_minutes,
                    "total_in_window": len(filtered_logs),
                }
            },
            confidence=0.9,
        )

    except Exception as e:
        logger.error(f"Failed to get logs around time: {str(e)}")
        return create_tool_result(
            status="error",
            message=f"Failed to get logs around time: {str(e)}",
            confidence=0.0,
        )


@FunctionTool
def search_render_error_logs(time_range_minutes: int = 30, limit: int = 100) -> dict:
    """
    Search for error-related logs in Render.com service.

    Args:
        time_range_minutes: How many minutes back to search (default: 30)
        limit: Maximum number of log logs to return

    Returns:
        Filtered error logs
    """
    try:
        logger.info(f"Searching render error logs: {time_range_minutes}min range")

        # Search for common error patterns
        result = _get_render_logs(
            time_range_minutes=time_range_minutes,
            limit=limit,
            search_query="error",
        )

        if result["status"] != "success":
            return result

        error_logs = result["logs"]["logs"]

        # Filtering for error-like logs
        filtered_errors = []
        for log in error_logs:
            message = log.get("message", "").lower()
            if any(
                keyword in message
                for keyword in ["error", "exception", "failed", "timeout", "500", "503"]
            ):
                log["level"] = _extract_log_level(message)
                filtered_errors.append(log)

        logger.info(f"Found {len(filtered_errors)} error log logs")

        return create_tool_result(
            status="success",
            message=f"Found {len(filtered_errors)} error logs",
            data={
                "error_logs": {
                    "logs": filtered_errors,
                    "total_found": len(filtered_errors),
                }
            },
            confidence=0.8,
        )

    except Exception as e:
        logger.error(f"Failed to search error logs: {str(e)}")
        return create_tool_result(
            status="error",
            message=f"Failed to search error logs: {str(e)}",
            confidence=0.0,
        )


# Helper functions


def _get_render_logs(
    time_range_minutes: int = 60,
    limit: int = 100,
    search_query: Optional[str] = None,
    target_time: Optional[str] = None,
) -> dict:
    """Core function to fetch logs from Render.com API."""
    try:
        # Get configuration from environment
        api_token = settings.toolset["render"].get("api_token")
        owner_id = settings.toolset["render"].get("owner_id")
        resource_id = settings.toolset["render"].get("resource_id")

        if not all([api_token, owner_id, resource_id]):
            return create_tool_result(
                status="error",
                message="Missing Render.com configuration. Set RENDER_API_TOKEN, RENDER_OWNER_ID, and RENDER_RESOURCE_ID environment variables.",
                confidence=0.0,
            )

        # Calculate time range
        if target_time:
            try:
                end_time = datetime.fromisoformat(target_time.replace("Z", "+00:00"))
            except ValueError:
                end_time = datetime.now(timezone.utc)
        else:
            end_time = datetime.now(timezone.utc)

        start_time = end_time - timedelta(minutes=time_range_minutes)

        # Prepare API request
        url = "https://api.render.com/v1/logs"
        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }

        params = {
            "ownerId": owner_id,
            "resource": [resource_id],
            "startTime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": min(limit, 100),  # Render.com max limit
            "direction": "backward",
        }

        # Add search query if provided
        if search_query:
            params["text"] = search_query

        logger.info(f"Fetching Render.com logs for resource {resource_id}")

        # Make API request
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, headers=headers, params=params)
            response.raise_for_status()

            logs_data = response.json()

            logs = logs_data.get("logs", [])
            processed_logs = []

            for log in logs:
                processed_log = {
                    "timestamp": log.get("timestamp"),
                    "message": log.get("message", ""),
                    "source": log.get("source", "unknown"),
                }
                processed_logs.append(processed_log)

            return {
                "status": "success",
                "logs": {"logs": processed_logs, "total_count": len(processed_logs)},
                "confidence": 0.9,
            }

    except httpx.HTTPStatusError as e:
        error_msg = f"Render.com API error: {e.response.status_code}"
        logger.error(error_msg)
        return {"status": "error", "error": error_msg, "confidence": 0.0}
    except Exception as e:
        error_msg = f"Failed to fetch Render.com logs: {str(e)}"
        logger.error(error_msg)
        return {"status": "error", "error": error_msg, "confidence": 0.0}


def _extract_log_level(message: str) -> str:
    """Extract log level from message content."""
    message_lower = message.lower()

    if any(
        keyword in message_lower
        for keyword in ["error", "exception", "failed", "fatal"]
    ):
        return "ERROR"
    elif any(keyword in message_lower for keyword in ["warn", "warning"]):
        return "WARN"
    else:
        return "INFO"
