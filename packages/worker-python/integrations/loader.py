"""Integration loader for dynamic tool creation."""

from typing import Any, Optional
import logging

from .registry import IntegrationRegistry
from .providers.base import BaseProvider, IntegrationContext

logger = logging.getLogger(__name__)


class IntegrationLoader:
    """
    Loader for dynamic integration tools.

    Takes integration contexts from the job data and creates provider instances
    with their associated tools for use by agents.
    """

    def __init__(self, integration_contexts: list[dict[str, Any]]):
        """
        Initialize loader with integration contexts.

        Args:
            integration_contexts: List of integration context dictionaries from job data
        """
        self.contexts = [
            IntegrationContext.from_dict(ctx) for ctx in integration_contexts
        ]
        self.providers: dict[str, BaseProvider] = {}
        self._load_providers()

    def _load_providers(self) -> None:
        """Load all providers from contexts."""
        for context in self.contexts:
            provider = IntegrationRegistry.create_provider(context)
            if provider:
                self.providers[context.type] = provider
                logger.info(
                    f"Loaded integration provider: {context.type} "
                    f"(connection: {context.connection_id})"
                )

    def get_provider(self, integration_type: str) -> Optional[BaseProvider]:
        """
        Get a loaded provider by type.

        Args:
            integration_type: Integration type (e.g., "github", "prometheus")

        Returns:
            Provider instance or None
        """
        return self.providers.get(integration_type)

    def get_tools(self) -> list[Any]:
        """
        Get all tools from all loaded providers.

        Returns:
            List of ADK tools from all providers
        """
        tools = []
        for provider in self.providers.values():
            try:
                provider_tools = provider.get_tools()
                tools.extend(provider_tools)
                logger.debug(
                    f"Loaded {len(provider_tools)} tools from {provider.name}"
                )
            except Exception as e:
                logger.error(f"Failed to get tools from {provider.name}: {e}")

        logger.info(f"Loaded {len(tools)} integration tools total")
        return tools

    def get_tools_by_type(self, integration_type: str) -> list[Any]:
        """
        Get tools from a specific provider.

        Args:
            integration_type: Integration type

        Returns:
            List of tools from that provider
        """
        provider = self.get_provider(integration_type)
        if not provider:
            return []
        return provider.get_tools()

    async def health_check_all(self) -> dict[str, bool]:
        """
        Run health checks on all providers.

        Returns:
            Dict mapping integration type to health status
        """
        results = {}
        for integration_type, provider in self.providers.items():
            try:
                results[integration_type] = await provider.health_check()
            except Exception as e:
                logger.error(f"Health check failed for {integration_type}: {e}")
                results[integration_type] = False

        return results

    def get_available_integrations(self) -> list[str]:
        """Get list of available integration types."""
        return list(self.providers.keys())

    def has_integration(self, integration_type: str) -> bool:
        """Check if an integration type is available."""
        return integration_type in self.providers

    def get_context(self, integration_type: str) -> Optional[IntegrationContext]:
        """Get the context for an integration type."""
        for ctx in self.contexts:
            if ctx.type == integration_type:
                return ctx
        return None
