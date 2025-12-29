"""
Agent Communication Tools for PrismaLens Worker.

This module contains function tools that enable proper agent-to-agent communication,
avoiding the AgentTool response transformation issue (GitHub issue #729).
"""

import logging

from google.adk.tools import FunctionTool, ToolContext
from google.adk.tools.agent_tool import AgentTool

from utils.tool_utils import create_tool_result

logger = logging.getLogger(__name__)


@FunctionTool
async def call_log_retriever_agent(
    alert_timestamp: str,
    service_name: str,
    alert_severity: str,
    tool_context: ToolContext,
) -> dict:
    """
    Call the log retriever agent to collect logs from Render.com services.

    This function tool properly wraps the log_retriever_agent to avoid the
    AgentTool response transformation issue where responses get converted
    to empty {"result":""} instead of preserving actual content.

    Args:
        alert_timestamp: The timestamp of the alert for log correlation
        service_name: Name of the service to collect logs for
        alert_severity: Severity level of the alert
        tool_context: Tool context with session state access

    Returns:
        Tool result containing log collection results
    """
    try:
        # Import here to avoid circular dependencies
        from agents.log_retriever.agent import create_log_retriever_agent

        logger.info(f"Calling log_retriever_agent for service: {service_name}")

        # Create the log retriever agent
        log_retriever_agent = create_log_retriever_agent()

        # Create AgentTool instance
        agent_tool = AgentTool(agent=log_retriever_agent)

        # Prepare message for the log retriever agent
        log_collection_request = f"""
        Collect logs for incident analysis:

        Alert Timestamp: {alert_timestamp}
        Service: {service_name}
        Severity: {alert_severity}

        Use your available tools to collect relevant logs and return your findings
        in the structured format as instructed.
        """

        # Call agent with proper arguments
        await agent_tool.run_async(
            args={"request": log_collection_request.strip()}, tool_context=tool_context
        )

        # Store in state for other agents to access
        tool_context.state["log_collection_completed"] = True
        tool_context.state["log_collection_service"] = service_name

        return create_tool_result(
            status="completed",
            message=f"Log collection completed for {service_name}",
            data={
                "log_results": tool_context.state.get("log_retriever_agent_output", {}),
                "service_name": service_name,
                "alert_timestamp": alert_timestamp,
                "collection_method": "log_retriever_agent_function_tool",
            },
            confidence=0.9,
        )

    except Exception as e:
        logger.error(f"Error calling log_retriever_agent: {e}")

        # Mark as failed in state
        tool_context.state["log_collection_completed"] = False
        tool_context.state["log_collection_error"] = str(e)

        return create_tool_result(
            status="error",
            message=f"Log collection failed: {str(e)}",
            data={
                "error": str(e),
                "service_name": service_name,
                "alert_timestamp": alert_timestamp,
                "suggestions": [
                    "Check log_retriever_agent configuration",
                    "Verify Render.com API connectivity",
                    "Check alert timestamp format",
                ],
            },
            confidence=0.0,
        )
