"""
GitHub Tool for PrismaLens Worker.

Creates FunctionTools for GitHub API using UTCP.
"""

import logging

from google.adk.tools.function_tool import FunctionTool

from config.settings import settings
from tools.utcp_lib import create_dynamic_utcp_tools

logger = logging.getLogger(__name__)


def create_github_tool() -> list[FunctionTool]:
    """
    Creates FunctionTools using the Universal Tool Calling Protocol (UTCP) via generic factory.
    """
    return create_dynamic_utcp_tools(
        spec_url=settings.get("GITHUB_OPENAPI_URL", ""),
        api_token=settings.get("GITHUB_TOKEN", ""),
        name_prefix="github",  # creates inspect_github_api, etc.
    )
