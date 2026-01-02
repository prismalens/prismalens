import requests
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)

class InternalApiClient:
    """Client for communicating with the Internal API."""

    def __init__(self, api_url: str, internal_secret: str):
        self.api_url = api_url.rstrip("/")
        self.internal_secret = internal_secret

    def get_llm_config(self) -> Optional[dict[str, Any]]:
        """Fetch active LLM configuration from the internal API."""
        try:
            url = f"{self.api_url}/api/internal/settings/llm-config"
            headers = {"X-Internal-Secret": self.internal_secret}
            
            response = requests.get(url, headers=headers, timeout=5)
            
            if response.status_code == 200:
                result = response.json()
                # API returns empty body if no active config
                return result if result else None
            elif response.status_code == 404:
                return None
            else:
                logger.warning(
                    f"Failed to fetch LLM config: HTTP {response.status_code} - {response.text}"
                )
                return None
        except Exception as e:
            logger.error(f"Error fetching LLM config from Internal API: {e}")
            return None

    def _headers(self) -> dict[str, str]:
        """Get common headers for internal API requests."""
        return {"X-Internal-Secret": self.internal_secret, "Content-Type": "application/json"}

    def update_investigation_status(
        self,
        investigation_id: str,
        status: str,
        started_at: Optional[str] = None,
        error: Optional[str] = None,
    ) -> bool:
        """
        Update investigation status via internal API.

        Args:
            investigation_id: UUID of the investigation
            status: New status ('pending', 'running', 'completed', 'failed', 'cancelled')
            started_at: ISO 8601 datetime string for when investigation started
            error: Error message if status is 'failed'

        Returns:
            True if successful, False otherwise
        """
        try:
            url = f"{self.api_url}/api/internal/investigations/{investigation_id}/status"
            payload: dict[str, Any] = {"status": status}

            if started_at:
                payload["startedAt"] = started_at
            if error:
                payload["error"] = error

            response = requests.patch(url, json=payload, headers=self._headers(), timeout=10)

            if response.status_code == 200:
                logger.info(f"Updated investigation {investigation_id} status to {status}")
                return True
            else:
                logger.warning(
                    f"Failed to update investigation status: HTTP {response.status_code} - {response.text}"
                )
                return False
        except Exception as e:
            logger.error(f"Error updating investigation status: {e}")
            return False

    def write_investigation_result(
        self,
        investigation_id: str,
        result: dict[str, Any],
    ) -> bool:
        """
        Write full investigation result via internal API.

        This performs an atomic write of the investigation result including:
        - Investigation fields (summary, rootCause, confidence, etc.)
        - Agent executions with nested tool executions
        - Recommendations
        - Incident status update
        - Timeline entry for completion

        Args:
            investigation_id: UUID of the investigation
            result: Full result payload containing:
                - status: 'completed' or 'failed'
                - incidentId: UUID of the incident
                - summary: Investigation summary
                - rootCause: Identified root cause
                - rootCauseCategory: Category of root cause
                - confidence: Confidence score (0-1)
                - agentExecutions: List of agent execution data
                - recommendations: List of recommendation data
                - error: Error message if failed

        Returns:
            True if successful, False otherwise
        """
        try:
            url = f"{self.api_url}/api/internal/investigations/{investigation_id}/result"
            response = requests.post(url, json=result, headers=self._headers(), timeout=30)

            if response.status_code in (200, 201):
                logger.info(f"Wrote investigation result for {investigation_id}")
                return True
            else:
                logger.warning(
                    f"Failed to write investigation result: HTTP {response.status_code} - {response.text}"
                )
                return False
        except Exception as e:
            logger.error(f"Error writing investigation result: {e}")
            return False

    def add_timeline_entry(self, entry: dict[str, Any]) -> bool:
        """
        Add a timeline entry via internal API.

        Args:
            entry: Timeline entry data containing:
                - incidentId: UUID of the incident
                - type: Entry type ('investigation_started', 'investigation_completed', etc.)
                - title: Entry title
                - description: Optional description
                - source: Source of entry ('system', 'user', 'ai_worker')
                - metadata: Optional additional metadata

        Returns:
            True if successful, False otherwise
        """
        try:
            url = f"{self.api_url}/api/internal/timeline"
            response = requests.post(url, json=entry, headers=self._headers(), timeout=10)

            if response.status_code in (200, 201):
                logger.debug(f"Added timeline entry: {entry.get('type')}")
                return True
            else:
                logger.warning(
                    f"Failed to add timeline entry: HTTP {response.status_code} - {response.text}"
                )
                return False
        except Exception as e:
            logger.error(f"Error adding timeline entry: {e}")
            return False
