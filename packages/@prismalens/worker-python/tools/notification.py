"""
Notification Function Tools for PrismaLens Worker.

Alert and recommendation formatting for notifications.
"""

import logging
from datetime import datetime
from typing import Optional

from google.adk.tools import FunctionTool, ToolContext

from utils.tool_utils import create_tool_result

logger = logging.getLogger(__name__)


@FunctionTool
def format_alert_message(
    alert_data: dict, analysis_data: Optional[dict] = None
) -> dict:
    """
    Format alert data into a readable message.

    Args:
        alert_data: Normalized alert data
        analysis_data: Analysis results (optional)

    Returns:
        Formatted message for notifications
    """
    try:
        # Extract basic info
        alert_name = alert_data.get("alertname", "Unknown Alert")
        service = alert_data.get("service", "Unknown Service")
        severity = alert_data.get("severity", "medium")
        timestamp = alert_data.get("timestamp", "")

        # Format timestamp
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            time_str = dt.strftime("%H:%M:%S UTC")
        except Exception:
            time_str = "Unknown time"

        # Create sample message
        severity_emoji = {
            "critical": "🔴",
            "high": "🟠",
            "medium": "🟡",
            "low": "🔵",
        }.get(severity, "🟡")
        subject = f"{severity_emoji} {severity.upper()}: {alert_name} - {service}"

        body = f"""ALERT: {severity.upper()}
                Alert: {alert_name}
                Service: {service}
                Time: {time_str}
                """

        # Add summary if available
        summary = alert_data.get("annotations", {}).get("summary", "")
        if summary:
            body += f"Summary: {summary}\n"

        # Add analysis if available
        if analysis_data and analysis_data.get("analysis", {}).get("potential_causes"):
            causes = analysis_data["analysis"]["potential_causes"]
            if causes:
                body += f"\nLikely cause: {causes[0].get('cause', 'Unknown')}\n"

        formatted = {
            "subject": subject,
            "body": body,
            "urgency": "high" if severity in ["critical", "high"] else "medium",
        }

        return create_tool_result(
            status="formatted",
            message="Alert message formatted successfully",
            data={"formatted": formatted},
        )

    except Exception as e:
        return create_tool_result(
            status="error",
            message=f"Message formatting failed: {str(e)}",
            confidence=0.0,
        )


@FunctionTool
def format_recommendation_message(
    tool_context: ToolContext,
    recommendations: list[dict],
    alert_data: Optional[dict] = None,
) -> dict:
    """
    Format recommendation data into actionable messages.

    Args:
        tool_context: Tool context for state access
        recommendations: List of recommendations
        alert_data: Original alert data for context

    Returns:
        Formatted recommendation messages
    """
    try:
        tool_context.state["recommendations"] = recommendations
        # Extract key information
        alert_name = (
            alert_data.get("alertname", "Unknown Alert")
            if alert_data
            else "Unknown Alert"
        )
        service = (
            alert_data.get("service", "Unknown Service")
            if alert_data
            else "Unknown Service"
        )
        severity = alert_data.get("severity", "medium") if alert_data else "medium"

        # Format summary
        summary = "**INCIDENT RECOMMENDATIONS**\n\n"
        summary += f"**Alert:** {alert_name}\n"
        summary += f"**Service:** {service}\n"
        summary += f"**Severity:** {severity.upper()}\n\n"

        # Add top recommendations
        summary += "**Recommended Actions:**\n"
        for i, rec in enumerate(recommendations[:5], 1):  # Top 5 recommendations
            title = rec.get("title", f"Recommendation {i}")
            priority = rec.get("priority", "medium")
            priority_icon = (
                "🔥" if priority == "critical" else "⚡" if priority == "high" else "📋"
            )
            summary += f"{priority_icon} {i}. {title}\n"

        if len(recommendations) > 5:
            summary += (
                f"\n_+{len(recommendations) - 5} additional recommendations available_"
            )

        formatted = {
            "summary": summary,
            "total_recommendations": len(recommendations),
            "high_priority_count": len(
                [
                    r
                    for r in recommendations
                    if r.get("priority") in ["critical", "high"]
                ]
            ),
            "urgency": "high" if severity in ["critical", "high"] else "medium",
        }

        return create_tool_result(
            status="formatted",
            message="Recommendation message formatted successfully",
            data={"formatted": formatted},
        )

    except Exception as e:
        return create_tool_result(
            status="error",
            message=f"Recommendation formatting failed: {str(e)}",
            confidence=0.0,
        )


@FunctionTool
def send_notification(
    message_data: dict, channels: Optional[list[str]] = None
) -> dict:
    """
    Mock notification sending for MVP.

    Args:
        message_data: Formatted message data
        channels: List of channels (slack, email, webhook)

    Returns:
        Notification sending results
    """
    try:
        if channels is None:
            channels = ["slack"]  # Default to slack

        results = {
            "sent_channels": [],
            "failed_channels": [],
            "notification_id": f"notif_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        }

        # Mock sending to each channel
        for channel in channels:
            if channel in ["slack", "email", "webhook"]:
                results["sent_channels"].append(channel)
            else:
                results["failed_channels"].append(channel)

        success_rate = len(results["sent_channels"]) / len(channels) if channels else 0

        return create_tool_result(
            status="sent" if success_rate > 0 else "failed",
            message=f"Notification sent to {len(results['sent_channels'])} of {len(channels)} channels",
            data={"results": results},
            confidence=success_rate,
        )

    except Exception as e:
        return create_tool_result(
            status="error",
            message=f"Notification sending failed: {str(e)}",
            confidence=0.0,
        )
