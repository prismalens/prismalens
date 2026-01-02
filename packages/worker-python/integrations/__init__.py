"""
Integration system for PrismaLens Worker.

This module provides dynamic integration loading and tool creation based on
user-configured integrations from the API.
"""

from .loader import IntegrationLoader
from .registry import IntegrationRegistry

__all__ = ["IntegrationLoader", "IntegrationRegistry"]
