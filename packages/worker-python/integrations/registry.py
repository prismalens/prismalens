"""Integration registry for provider discovery and instantiation."""

from typing import Type, Optional
import logging

from .providers.base import BaseProvider, IntegrationContext
from .providers.github import GitHubProvider
from .providers.prometheus import PrometheusProvider
from .providers.slack import SlackProvider

logger = logging.getLogger(__name__)


class IntegrationRegistry:
    """
    Registry for integration providers.

    Maintains a mapping of integration types to their provider classes,
    allowing dynamic instantiation based on configuration.
    """

    _providers: dict[str, Type[BaseProvider]] = {
        "github": GitHubProvider,
        "prometheus": PrometheusProvider,
        "slack": SlackProvider,
    }

    @classmethod
    def register(cls, name: str, provider_class: Type[BaseProvider]) -> None:
        """
        Register a new provider class.

        Args:
            name: Integration name (e.g., "github", "datadog")
            provider_class: Provider class to register
        """
        cls._providers[name] = provider_class
        logger.info(f"Registered integration provider: {name}")

    @classmethod
    def get_provider_class(cls, name: str) -> Optional[Type[BaseProvider]]:
        """
        Get a provider class by name.

        Args:
            name: Integration name

        Returns:
            Provider class or None if not found
        """
        return cls._providers.get(name)

    @classmethod
    def create_provider(
        cls,
        context: IntegrationContext,
    ) -> Optional[BaseProvider]:
        """
        Create a provider instance from integration context.

        Args:
            context: Integration context with credentials and config

        Returns:
            Provider instance or None if provider not found
        """
        provider_class = cls.get_provider_class(context.type)
        if not provider_class:
            logger.warning(f"No provider found for integration type: {context.type}")
            return None

        try:
            return provider_class(context)
        except Exception as e:
            logger.error(f"Failed to create provider for {context.type}: {e}")
            return None

    @classmethod
    def list_providers(cls) -> list[str]:
        """Get list of registered provider names."""
        return list(cls._providers.keys())
