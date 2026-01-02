"""Base provider class for integrations."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class IntegrationContext:
    """Context for an integration, passed from the API."""

    type: str
    connection_id: str
    credentials: dict[str, Any]
    config: dict[str, Any] = field(default_factory=dict)
    service_overrides: Optional[dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "IntegrationContext":
        """Create from API response dictionary."""
        return cls(
            type=data["type"],
            connection_id=data["connectionId"],
            credentials=data["credentials"],
            config=data.get("config", {}),
            service_overrides=data.get("serviceOverrides"),
        )

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get config value, checking service overrides first."""
        if self.service_overrides and key in self.service_overrides:
            return self.service_overrides[key]
        return self.config.get(key, default)


class BaseProvider(ABC):
    """
    Base class for integration providers.

    Each provider implements tools for a specific external service
    (GitHub, Prometheus, Slack, etc.).
    """

    # Provider name (matches integration definition name)
    name: str = "base"

    def __init__(self, context: IntegrationContext):
        """
        Initialize provider with integration context.

        Args:
            context: Integration context containing credentials and config
        """
        self.context = context
        self.logger = logging.getLogger(f"{__name__}.{self.name}")

    @abstractmethod
    def get_tools(self) -> list[Any]:
        """
        Get ADK tools for this provider.

        Returns:
            List of tool functions or FunctionTool instances
        """
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """
        Check if the integration is healthy/connected.

        Returns:
            True if connected and working
        """
        pass

    def get_credential(self, key: str, default: Any = None) -> Any:
        """Get a credential value."""
        return self.context.credentials.get(key, default)

    def get_token(self) -> Optional[str]:
        """Get the primary authentication token."""
        return (
            self.get_credential("accessToken")
            or self.get_credential("apiKey")
            or self.get_credential("token")
        )
