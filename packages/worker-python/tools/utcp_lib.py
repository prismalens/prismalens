"""
UTCP Wrapper for PrismaLens Worker.

This module provides a simplified interface to the official `utcp` library,
handling the complexity of:
1. Fetching OpenAPI specs from URLs.
2. Converting them to UTCP Manuals/Tools.
3. Injecting them into the UtcpClient's repository.
4. Handling Authentication via global headers.
"""

import asyncio
import logging
from typing import Any, Optional

import requests
import yaml
from google.adk.tools.function_tool import FunctionTool
from utcp.data.tool import Tool
from utcp.data.utcp_manual import UtcpManual
from utcp.utcp_client import UtcpClient
from utcp_http.http_call_template import HttpCallTemplate
from utcp_http.openapi_converter import OpenApiConverter

logger = logging.getLogger(__name__)


class UtcpClientWrapper:
    """Wrapper around the official UtcpClient for OpenAPI consumption."""

    def __init__(self) -> None:
        self._client: Optional[UtcpClient] = None

    async def initialize(
        self, spec_url: str, api_token: Optional[str] = None
    ) -> None:
        """Initialize the client with an OpenAPI spec."""
        try:
            # 1. Fetch OpenAPI Spec
            resp = requests.get(spec_url, timeout=30)
            resp.raise_for_status()

            try:
                spec_content = yaml.safe_load(resp.content)
            except Exception:
                spec_content = resp.json()

            # 2. Configure Auth (if provided)
            # The OpenApiConverter uses 'Auth' objects, but for simplicity
            # we might rely on the client injection or just passed headers.

            # 3. Convert to UTCP Manual
            # We explicitly set a call_template_name to be used for the manual
            manual_name = "remote_api_manual"
            converter = OpenApiConverter(
                openapi_spec=spec_content,
                spec_url=spec_url,
                call_template_name=manual_name,
            )
            manual: UtcpManual = converter.convert()

            # 4. Create UtcpClient
            # We use the factory method which sets up defaults (InMemToolRepository)
            self._client = await UtcpClient.create()

            # 5. Inject Manual into Repository
            # We need a dummy CallTemplate for the manual itself
            # The converter stores the normalized name in self.call_template_name
            manual_template = HttpCallTemplate(
                name=converter.call_template_name,
                url=spec_url,  # Using spec URL as identifying URL
                http_method="GET",
            )

            # Access the repository directly
            repo = self._client.config.tool_repository
            await repo.save_manual(manual_template, manual)

            # 6. Store Auth Token globally if needed
            if api_token:
                self._inject_auth_headers(manual, api_token)
                # Re-save to update index
                await repo.save_manual(manual_template, manual)

            logger.info(
                f"Initialized UTCP Client with {len(manual.tools)} tools from {spec_url}"
            )

        except Exception as e:
            logger.error(f"Failed to initialize UTCP Wrapper: {e}")
            raise

    def _inject_auth_headers(self, manual: UtcpManual, token: str) -> None:
        """Inject Authorization header into all tools."""
        for tool in manual.tools:
            template = tool.tool_call_template
            if isinstance(template, HttpCallTemplate):
                # Ensure headers dict exists
                if template.headers is None:
                    template.headers = {}

                # Set Bearer token
                template.headers["Authorization"] = f"Bearer {token}"
                template.headers["User-Agent"] = "PrismaLens-Agent/1.0"

    def search_tools(self, query: str) -> list[Tool]:
        """Search for tools synchronously (blocking)."""
        if not self._client:
            return []

        # UtcpClient methods are async, so we must run in loop
        return asyncio.run(self._client.search_tools(query, limit=10))

    def get_tool_manual(self, tool_name: str) -> str:
        """Get the manual (CallTemplate+Schema) for a tool."""
        if not self._client:
            return "Client not initialized."

        async def _get() -> str:
            tool = await self._client.config.tool_repository.get_tool(tool_name)
            return str(tool.tool_call_template) if tool else "Tool not found."

        return asyncio.run(_get())

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Execute a tool."""
        if not self._client:
            raise RuntimeError("Client not initialized")

        return asyncio.run(self._client.call_tool(tool_name, arguments))


# Standalone helper factory
def create_utcp_client(spec_url: str, token: str) -> UtcpClientWrapper:
    """Create and initialize a UTCP client wrapper."""
    wrapper = UtcpClientWrapper()
    # We use asyncio.run to execute the async init synchronously for the caller
    asyncio.run(wrapper.initialize(spec_url, token))
    return wrapper


def create_dynamic_utcp_tools(
    spec_url: str, api_token: str, name_prefix: str
) -> list[FunctionTool]:
    """
    Dynamically creates a set of Google ADK FunctionTools for a UTCP-compliant API.

    Generates 3 tools:
    1. inspect_{prefix}_api: Search/Discovery
    2. read_{prefix}_tool_manual: Documentation
    3. call_{prefix}_api: Execution
    """
    if not spec_url or not api_token:
        logger.warning(f"Missing configuration for {name_prefix} UTCP tools.")
        return []

    try:
        # 1. Initialize Wrapper
        client = create_utcp_client(spec_url, api_token)

        # 2. Define Closures
        def inspect_api(search_term: str) -> str:
            """
            Search tools using UTCP.
            Args:
                search_term: Query string
            """
            try:
                results = client.search_tools(search_term)
                if not results:
                    return f"No tools found for '{search_term}'"

                output = [f"Found {len(results)} tools via UTCP:"]
                for tool in results:
                    output.append(f"- {tool.name}: {tool.description}")
                return "\n".join(output)
            except Exception as e:
                return f"Error searching tools: {e}"

        def read_manual(tool_name: str) -> str:
            """
            Get the usage manual for a specific tool.
            Args:
                 tool_name: The exact name of the tool
            """
            return client.get_tool_manual(tool_name)

        def call_api(tool_name: str, arguments: dict) -> str:
            """
            Execute a tool call using UTCP.
            Args:
                tool_name: The tool to call
                arguments: Dictionary of arguments matching the manual
            """
            try:
                result = client.execute(tool_name, arguments)
                return str(result)
            except Exception as e:
                return f"UTCP Execution Error: {str(e)}"

        # 3. Dynamic Renaming (Magic)
        # We rename the functions so the LLM sees distinct tool names
        inspect_api.__name__ = f"inspect_{name_prefix}_api"
        inspect_api.__doc__ = f"Search {name_prefix.capitalize()} API tools using UTCP.\nArgs:\n    search_term: Query string"

        read_manual.__name__ = f"read_{name_prefix}_tool_manual"
        read_manual.__doc__ = f"Get the usage manual for a specific {name_prefix.capitalize()} tool.\nArgs:\n    tool_name: The exact name of the tool"

        call_api.__name__ = f"call_{name_prefix}_api"
        call_api.__doc__ = f"Execute a {name_prefix.capitalize()} API call using UTCP.\nArgs:\n    tool_name: The tool to call\n    arguments: Dictionary of arguments"

        # 4. Return FunctionTools
        return [
            FunctionTool(inspect_api),
            FunctionTool(read_manual),
            FunctionTool(call_api),
        ]

    except Exception as e:
        logger.error(f"Failed to create {name_prefix} UTCP tools: {e}")
        return []
