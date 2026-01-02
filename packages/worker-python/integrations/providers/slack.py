"""Slack integration provider."""

import httpx
from typing import Any, Optional
import json

from google.adk.tools import FunctionTool

from .base import BaseProvider, IntegrationContext


class SlackProvider(BaseProvider):
    """
    Slack integration provider.

    Provides tools for:
    - Sending messages to channels
    - Sending investigation summaries
    - Sending recommendation alerts
    """

    name = "slack"

    def __init__(self, context: IntegrationContext):
        super().__init__(context)
        self.default_channel = context.get_config("defaultChannel", "#incidents")
        self.webhook_url = context.get_config("webhookUrl")
        self.mention_users = context.get_config("mentionUsers", [])
        self.include_summary = context.get_config("includeSummary", True)

    def _get_headers(self) -> dict[str, str]:
        """Get headers for Slack API requests."""
        token = self.get_token()

        if token and not token.startswith("https://"):
            return {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }

        # Webhook doesn't need auth headers
        return {"Content-Type": "application/json"}

    async def health_check(self) -> bool:
        """Check Slack API connectivity."""
        token = self.get_token()

        # If using webhook URL, we can't really test it without sending a message
        if token and token.startswith("https://hooks.slack.com/"):
            return True

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://slack.com/api/auth.test",
                    headers=self._get_headers(),
                    timeout=10.0,
                )
                if response.status_code == 200:
                    data = response.json()
                    return data.get("ok", False)
                return False
        except Exception as e:
            self.logger.error(f"Slack health check failed: {e}")
            return False

    def get_tools(self) -> list[FunctionTool]:
        """Get ADK tools for Slack integration."""
        return [
            FunctionTool(self.send_message),
            FunctionTool(self.send_investigation_summary),
            FunctionTool(self.send_recommendation_alert),
        ]

    async def send_message(
        self,
        message: str,
        channel: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Send a simple message to a Slack channel.

        Args:
            message: Message text to send
            channel: Channel to send to (defaults to configured channel)

        Returns:
            Dict with send result
        """
        channel = channel or self.default_channel
        token = self.get_token()

        try:
            # Use webhook if available
            if self.webhook_url or (token and token.startswith("https://")):
                return await self._send_webhook(message)

            # Use Slack API
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://slack.com/api/chat.postMessage",
                    headers=self._get_headers(),
                    json={
                        "channel": channel,
                        "text": message,
                        "unfurl_links": False,
                    },
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "success": False,
                        "error": f"Slack API error: {response.status_code}",
                    }

                data = response.json()
                if not data.get("ok"):
                    return {
                        "success": False,
                        "error": data.get("error", "Unknown error"),
                    }

                return {
                    "success": True,
                    "channel": channel,
                    "ts": data.get("ts"),
                }

        except Exception as e:
            self.logger.error(f"Failed to send message: {e}")
            return {"success": False, "error": str(e)}

    async def _send_webhook(self, message: str) -> dict[str, Any]:
        """Send message via webhook URL."""
        url = self.webhook_url or self.get_token()

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    json={"text": message},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    return {"success": True}

                return {
                    "success": False,
                    "error": f"Webhook error: {response.status_code}",
                }

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def send_investigation_summary(
        self,
        incident_number: int,
        incident_title: str,
        summary: str,
        root_cause: Optional[str] = None,
        confidence: float = 0.0,
        recommendations_count: int = 0,
        channel: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Send a formatted investigation summary to Slack.

        Args:
            incident_number: Incident number (e.g., 123)
            incident_title: Incident title
            summary: Investigation summary
            root_cause: Identified root cause (if any)
            confidence: Confidence score (0.0 to 1.0)
            recommendations_count: Number of recommendations generated
            channel: Channel to send to

        Returns:
            Dict with send result
        """
        channel = channel or self.default_channel

        # Build Slack blocks
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f":mag: Investigation Complete: INC-{incident_number}",
                    "emoji": True,
                },
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{incident_title}*",
                },
            },
            {"type": "divider"},
        ]

        if self.include_summary and summary:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Summary:*\n{summary[:2000]}",  # Slack limit
                },
            })

        if root_cause:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Root Cause:*\n{root_cause[:1000]}",
                },
            })

        # Confidence and recommendations
        confidence_emoji = (
            ":white_check_mark:" if confidence >= 0.7
            else ":warning:" if confidence >= 0.4
            else ":question:"
        )

        blocks.append({
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"{confidence_emoji} Confidence: {confidence:.0%}",
                },
                {
                    "type": "mrkdwn",
                    "text": f":clipboard: {recommendations_count} recommendations",
                },
            ],
        })

        return await self._send_blocks(blocks, channel)

    async def send_recommendation_alert(
        self,
        incident_number: int,
        recommendation_title: str,
        recommendation_description: str,
        priority: str = "medium",
        category: Optional[str] = None,
        channel: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Send a high-priority recommendation alert to Slack.

        Args:
            incident_number: Incident number
            recommendation_title: Recommendation title
            recommendation_description: Recommendation description
            priority: Priority level (critical, high, medium, low)
            category: Recommendation category
            channel: Channel to send to

        Returns:
            Dict with send result
        """
        channel = channel or self.default_channel

        # Priority emoji and color
        priority_config = {
            "critical": (":rotating_light:", "#dc3545"),
            "high": (":warning:", "#fd7e14"),
            "medium": (":information_source:", "#0dcaf0"),
            "low": (":bulb:", "#6c757d"),
        }
        emoji, color = priority_config.get(priority, (":bulb:", "#6c757d"))

        # Build mention string for critical/high priority
        mentions = ""
        if priority in ("critical", "high") and self.mention_users:
            mentions = " ".join(f"<@{u}>" for u in self.mention_users) + " "

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{emoji} Recommendation: INC-{incident_number}",
                    "emoji": True,
                },
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{mentions}*{recommendation_title}*",
                },
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": recommendation_description[:2000],
                },
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Priority: *{priority.upper()}*",
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"Category: {category or 'General'}",
                    },
                ],
            },
        ]

        return await self._send_blocks(blocks, channel)

    async def _send_blocks(
        self,
        blocks: list[dict],
        channel: str,
    ) -> dict[str, Any]:
        """Send a message with blocks to Slack."""
        token = self.get_token()

        try:
            # Use webhook if available
            if self.webhook_url or (token and token.startswith("https://")):
                url = self.webhook_url or token
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        url,
                        json={"blocks": blocks},
                        timeout=30.0,
                    )
                    if response.status_code == 200:
                        return {"success": True}
                    return {
                        "success": False,
                        "error": f"Webhook error: {response.status_code}",
                    }

            # Use Slack API
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://slack.com/api/chat.postMessage",
                    headers=self._get_headers(),
                    json={
                        "channel": channel,
                        "blocks": blocks,
                        "unfurl_links": False,
                    },
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "success": False,
                        "error": f"Slack API error: {response.status_code}",
                    }

                data = response.json()
                if not data.get("ok"):
                    return {
                        "success": False,
                        "error": data.get("error", "Unknown error"),
                    }

                return {
                    "success": True,
                    "channel": channel,
                    "ts": data.get("ts"),
                }

        except Exception as e:
            self.logger.error(f"Failed to send blocks: {e}")
            return {"success": False, "error": str(e)}
