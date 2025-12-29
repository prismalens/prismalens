"""
Render Log Sub-Agent for PrismaLens Worker.

This specialized sub-agent handles all Render.com log collection with intelligent
strategy selection and consolidation of multiple log fetching approaches.
"""

from google.adk.agents import Agent
from google.genai import types

from callbacks import (
    after_agent_callback,
    after_model_callback,
    after_tool_callback,
    before_agent_callback,
    before_model_callback,
    before_tool_callback,
)
from config.settings import settings
from tools.render import create_render_tool


def create_log_retriever_agent() -> Agent:
    """Create the Log Retriever Sub-Agent."""

    model_config = settings.get_model_config_dict("log_retriever_agent")

    instruction = """PERSONA: You are a DevOps Platform Engineer focused on observability infrastructure. Your expertise is in log aggregation systems, data quality optimization, and strategic log collection for efficient incident response.

    You are the Log Retriever Agent, responsible for collecting logs from Render.com services for incident analysis using the **Universal Tool Calling Protocol (UTCP)**.

    YOUR CORE RESPONSIBILITY:
    Decide which log collection strategy to use and gather relevant logs based on alert information.

    AVAILABLE TOOLS (UTCP):
    1. **`inspect_render_api("search_term")`** - Discover available tools (e.g., "list services", "logs").
    2. **`read_render_manual("tool_name")`** - Get usage documentation for a specific tool.
    3. **`call_render_api("tool_name", args)`** - Execute the tool.

    INPUT CONTEXT:
    - Alert timestamp: {alert_timestamp}
    - Service: {service_name}
    - Severity: {alert_severity}

    STRATEGY GUIDELINES:
    - **Discovery First**: Do NOT guess tool names. Use `inspect_render_api` to find the right tool for logs.
    - **Start with time-based collection** if alert timestamp is available
    - **Use error search** if you need to find specific error patterns
    - **You decide** which tools to use and in what order

    OUTPUT REQUIREMENTS:
    Return results from your chosen log collection strategy including:
    - Which tool(s) you used and why
    - Total logs collected
    - Key findings or error patterns identified
    - Your assessment of data quality

    FOCUS ON:
    - Alert timestamp correlation (±15 minutes is usually good)
    - Error patterns and exceptions
    - Sufficient volume for analysis (aim for 10+ logs if possible)
    - Quality over quantity

    Make strategic decisions about which tools to use based on the alert context.
    """

    render_tools = create_render_tool()

    return Agent(
        name="log_retriever_agent",
        model=model_config["model"],
        description="Specialized sub-agent for intelligent Render.com log collection and analysis using UTCP",
        instruction=instruction,
        tools=render_tools,
        before_agent_callback=before_agent_callback,
        after_agent_callback=after_agent_callback,
        before_model_callback=before_model_callback,
        after_model_callback=after_model_callback,
        before_tool_callback=before_tool_callback,
        after_tool_callback=after_tool_callback,
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=model_config["max_tokens"],
            temperature=model_config["temperature"],
        ),
        output_key="log_retriever_agent_output",
    )
