"""
Render.com Tool for PrismaLens Worker.

Creates FunctionTools for Render.com API using UTCP.
"""

import logging

from google.adk.tools.function_tool import FunctionTool

from config.settings import settings
from tools.utcp_lib import create_dynamic_utcp_tools

logger = logging.getLogger(__name__)


def create_render_tool() -> list[FunctionTool]:
    """
    Creates FunctionTools for Render.com using UTCP via generic factory.
    """
    render_config = settings.toolset.get("render", {})
    return create_dynamic_utcp_tools(
        spec_url=render_config.get("openapi_url"),
        api_token=render_config.get("api_token"),
        name_prefix="render",  # creates inspect_render_api, etc.
    )
