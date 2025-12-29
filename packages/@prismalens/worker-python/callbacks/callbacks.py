"""
ADK callback handlers for PrismaLens Worker.

This module provides callback functions for tracking agent workflow execution,
tool usage, and LLM calls. All callbacks follow Google ADK callback signatures.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models import LlmRequest, LlmResponse
from google.adk.sessions.state import State
from google.adk.tools import BaseTool, ToolContext
from google.genai import types

logger = logging.getLogger(__name__)


def before_tool_callback(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> Optional[dict]:
    """
    Called before any tool execution - track tool calls and update workflow state.

    Args:
        tool: The tool being called
        args: Arguments passed to the tool
        tool_context: Tool context with state access

    Returns:
        None to allow tool execution, or Dict to override tool arguments
    """
    try:
        tool_name = getattr(tool, "name", tool.__class__.__name__)
        agent_name = getattr(tool_context, "agent_name", "unknown_agent")

        logger.info("Tool starting: %s by %s", tool_name, agent_name)
        logger.debug("Tool %s arguments: %s", tool_name, args)

        # Initialize tracking structures if needed
        if "tool_executions" not in tool_context.state:
            tool_context.state["tool_executions"] = []
        if "tool_statistics" not in tool_context.state:
            tool_context.state["tool_statistics"] = {}
        if "workflow_tracking" not in tool_context.state:
            tool_context.state["workflow_tracking"] = {
                "initialized_at": datetime.now(timezone.utc).isoformat()
            }

        # Track tool start time for duration calculation
        if "active_tools" not in tool_context.state:
            tool_context.state["active_tools"] = {}

        tool_key = f"{agent_name}_{tool_name}_{datetime.now().timestamp()}"
        tool_context.state["active_tools"][tool_key] = {
            "tool_name": tool_name,
            "agent_name": agent_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "arguments": args,
        }

        # Store the key for use in after_tool_callback
        tool_context.state["_current_tool_key"] = tool_key

        return None  # Allow tool execution with original args

    except Exception as e:
        logger.error("Error in before_tool_callback: %s", e)
        return None


def after_tool_callback(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: Any,
) -> Optional[dict]:
    """
    Called after tool execution - record results and update workflow progress.

    Args:
        tool: The tool that was called
        args: Arguments that were passed to the tool
        tool_context: Tool context with state access
        tool_response: Tool execution result

    Returns:
        None to keep original result, or Dict to override result
    """
    try:
        # Get the active tool info
        tool_key = tool_context.state.get("_current_tool_key")
        if not tool_key or tool_key not in tool_context.state.get("active_tools", {}):
            logger.warning("No active tool found for after_tool_callback")
            return None

        active_tool = tool_context.state["active_tools"][tool_key]
        tool_name = active_tool["tool_name"]
        agent_name = active_tool["agent_name"]
        started_at = datetime.fromisoformat(active_tool["started_at"])

        # Calculate execution time
        ended_at = datetime.now(timezone.utc)
        execution_time = (ended_at - started_at).total_seconds()

        # Determine success based on response type
        if hasattr(tool_response, "content"):
            # MCP tool result
            is_error = getattr(tool_response, "isError", None)
            success = not is_error if is_error is not None else True
            status = "success" if success else "error"
            confidence = 0.8 if success else 0.0
            tool_response_dict = {
                "content": getattr(tool_response, "content", None),
                "status": status,
                "confidence": confidence,
            }
        elif isinstance(tool_response, dict):
            tool_response_dict = tool_response
            success = tool_response_dict.get("status") not in ["error", "failed"]
            status = tool_response_dict.get("status", "unknown")
            confidence = tool_response_dict.get("confidence", 0.0)
        else:
            tool_response_dict = {}
            success = True
            status = "unknown"
            confidence = 0.0

        # Log tool completion
        status_icon = "+" if success else "x"
        logger.info(
            "   [%s] Tool completed: %s (%.1fs)", status_icon, tool_name, execution_time
        )
        logger.info("   Status: %s, Confidence: %.2f", status, confidence)
        logger.debug("Tool %s response: %s", tool_name, tool_response)

        # Record tool execution
        execution_record = {
            "tool_name": tool_name,
            "agent_name": agent_name,
            "executed_at": ended_at.isoformat(),
            "execution_time_seconds": execution_time,
            "success": success,
            "arguments": args,
            "result": tool_response_dict,
            "status": status,
            "confidence": confidence,
        }

        tool_context.state["tool_executions"].append(execution_record)

        # Update tool statistics
        _update_tool_statistics(
            tool_context.state, tool_name, agent_name, success, execution_time
        )

        # Clean up
        if tool_key in tool_context.state.get("active_tools", {}):
            tool_context.state["active_tools"][tool_key] = None
        if "_current_tool_key" in tool_context.state:
            tool_context.state["_current_tool_key"] = None

        return None

    except Exception as e:
        logger.error("Error in after_tool_callback: %s", e)
        return None


def before_agent_callback(callback_context: CallbackContext) -> Optional[types.Content]:
    """
    Called before agent execution - set up agent tracking.

    Args:
        callback_context: ADK callback context

    Returns:
        None to allow agent execution, or Content to skip agent
    """
    try:
        agent_name = callback_context.agent_name
        logger.info("Starting agent: %s", agent_name)

        # Log workflow progression status
        agent_progression = callback_context.state.get("agent_progression", {})
        completed_count = sum(1 for v in agent_progression.values() if v is True)
        if completed_count > 0:
            logger.info("Previously completed agents: %d", completed_count)

        # Initialize agent executions list if needed
        if "agent_executions" not in callback_context.state:
            callback_context.state["agent_executions"] = []

        # Update workflow stage
        if "coordinator" not in agent_name.lower():
            callback_context.state["workflow_stage"] = agent_name.lower() + "_active"
        logger.info("Workflow stage: %s", callback_context.state.get("workflow_stage"))

        # Track agent start
        agent_execution = {
            "agent_name": agent_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "started",
        }

        callback_context.state["agent_executions"].append(agent_execution)

        return None

    except Exception as e:
        logger.error("Error in before_agent_callback: %s", e)
        return None


def after_agent_callback(callback_context: CallbackContext) -> Optional[types.Content]:
    """
    Called after agent execution - update agent progression and workflow state.

    Args:
        callback_context: ADK callback context

    Returns:
        None to keep original response, or Content to override response
    """
    try:
        agent_name = callback_context.agent_name

        # Update the last agent execution record
        execution_time = None
        agent_executions = callback_context.state.get("agent_executions", [])
        if agent_executions:
            last_execution = agent_executions[-1]
            if last_execution["agent_name"] == agent_name:
                last_execution["completed_at"] = datetime.now(timezone.utc).isoformat()
                last_execution["status"] = "completed"

                started_at = datetime.fromisoformat(last_execution["started_at"])
                completed_at = datetime.now(timezone.utc)
                execution_time = (completed_at - started_at).total_seconds()
                last_execution["execution_time_seconds"] = execution_time

        if execution_time:
            logger.info("Agent completed: %s (%.1fs)", agent_name, execution_time)
        else:
            logger.info("Agent completed: %s", agent_name)

        # Log tools used by this agent
        tool_executions = callback_context.state.get("tool_executions", [])
        agent_tools = [t for t in tool_executions if t.get("agent_name") == agent_name]
        if agent_tools:
            tool_names = [t["tool_name"] for t in agent_tools[-5:]]
            logger.info(
                "%s used %d tools: %s",
                agent_name,
                len(agent_tools),
                ", ".join(tool_names),
            )

        callback_context.state["workflow_stage"] = agent_name.lower() + "_completed"
        logger.info("Workflow stage: %s", callback_context.state["workflow_stage"])

        if "coordinator" in agent_name.lower():
            callback_context.state["workflow_stage"] = "workflow_completed"
            logger.info("Workflow completed")

        _update_agent_progression(callback_context.state, agent_name, True)
        _calculate_workflow_confidence(callback_context.state)

        return None

    except Exception as e:
        logger.error("Error in after_agent_callback: %s", e)
        return None


def before_model_callback(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """
    Called before LLM call - track request metadata.

    Args:
        callback_context: ADK callback context
        llm_request: Request being sent to LLM

    Returns:
        None to allow LLM call, or LlmResponse to skip LLM call
    """
    try:
        agent_name = callback_context.agent_name
        logger.debug("LLM call starting for agent: %s", agent_name)

        if "model_calls" not in callback_context.state:
            callback_context.state["model_calls"] = []
        if "model_statistics" not in callback_context.state:
            callback_context.state["model_statistics"] = {
                "total_calls": 0,
                "total_tokens_sent": 0,
                "agents_using_llm": [],
            }

        correlation_id = str(uuid.uuid4())[:8]
        estimated_tokens = len(str(llm_request)) // 4

        call_record = {
            "correlation_id": correlation_id,
            "agent_name": agent_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "estimated_input_tokens": estimated_tokens,
            "status": "started",
        }

        callback_context.state["model_calls"].append(call_record)
        callback_context.state["_current_model_call_id"] = correlation_id

        stats = callback_context.state["model_statistics"]
        stats["total_calls"] += 1
        stats["total_tokens_sent"] += estimated_tokens
        if agent_name not in stats["agents_using_llm"]:
            stats["agents_using_llm"].append(agent_name)

        logger.debug("LLM request [%s]: ~%d tokens", correlation_id, estimated_tokens)

        return None

    except Exception as e:
        logger.error("Error in before_model_callback: %s", e)
        return None


def after_model_callback(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """
    Called after LLM call - track response metadata and performance.

    Args:
        callback_context: ADK callback context
        llm_response: The actual model response

    Returns:
        None to keep original response, or LlmResponse to override response
    """
    try:
        correlation_id = callback_context.state.get("_current_model_call_id")

        model_calls = callback_context.state.get("model_calls", [])
        call_record = None
        for call in model_calls:
            if call.get("correlation_id") == correlation_id:
                call_record = call
                break

        if not call_record:
            logger.warning("No matching model call found for: %s", correlation_id)
            return None

        started_at = datetime.fromisoformat(call_record["started_at"])
        completed_at = datetime.now(timezone.utc)
        response_time = (completed_at - started_at).total_seconds()

        response_tokens = 0
        finish_reason = "unknown"

        if hasattr(llm_response, "error_code") and llm_response.error_code:
            finish_reason = f"error_{llm_response.error_code}"
        elif hasattr(llm_response, "interrupted") and llm_response.interrupted:
            finish_reason = "interrupted"
        elif hasattr(llm_response, "turn_complete") and llm_response.turn_complete:
            finish_reason = "complete"
        elif hasattr(llm_response, "partial") and llm_response.partial:
            finish_reason = "partial"

        if hasattr(llm_response, "content") and llm_response.content:
            content_text = str(llm_response.content)
            response_tokens = len(content_text) // 4

        call_record.update(
            {
                "completed_at": completed_at.isoformat(),
                "response_time_seconds": response_time,
                "output_tokens": response_tokens,
                "finish_reason": finish_reason,
                "status": "completed",
            }
        )

        stats = callback_context.state.get("model_statistics", {})
        stats["total_tokens_received"] = (
            stats.get("total_tokens_received", 0) + response_tokens
        )
        stats["total_response_time"] = (
            stats.get("total_response_time", 0.0) + response_time
        )
        stats["average_response_time"] = (
            stats["total_response_time"] / stats["total_calls"]
        )

        logger.info(
            "LLM completed [%s]: ~%d tokens (%.2fs)",
            correlation_id,
            response_tokens,
            response_time,
        )

        if "_current_model_call_id" in callback_context.state:
            callback_context.state["_current_model_call_id"] = None

        return None

    except Exception as e:
        logger.error("Error in after_model_callback: %s", e)
        return None


# Helper functions


def _update_tool_statistics(
    state: State, tool_name: str, agent_name: str, success: bool, execution_time: float
) -> None:
    """Update tool statistics in state."""
    try:
        stats = state["tool_statistics"]

        if tool_name not in stats:
            stats[tool_name] = {
                "total_executions": 0,
                "successful_executions": 0,
                "total_execution_time": 0.0,
                "average_execution_time": 0.0,
                "agents_used": [],
                "last_used": None,
            }

        tool_stats = stats[tool_name]
        tool_stats["total_executions"] += 1

        if success:
            tool_stats["successful_executions"] += 1

        tool_stats["total_execution_time"] += execution_time
        tool_stats["average_execution_time"] = (
            tool_stats["total_execution_time"] / tool_stats["total_executions"]
        )

        if agent_name not in tool_stats["agents_used"]:
            tool_stats["agents_used"].append(agent_name)

        tool_stats["last_used"] = datetime.now(timezone.utc).isoformat()

    except Exception as e:
        logger.error("Failed to update tool statistics: %s", e)


def _update_agent_progression(state: State, agent_name: str, completed: bool) -> None:
    """Update agent progression in state."""
    try:
        if "agent_progression" not in state:
            state["agent_progression"] = {}

        agent_field_map = {
            "alert": "alert_agent_completed",
            "gatherer": "gatherer_agent_completed",
            "analyzer": "analyzer_agent_completed",
            "recommender": "recommender_agent_completed",
            "log_retriever": "log_retriever_agent_completed",
        }

        normalized_name = agent_name.lower()
        updated = False

        for key, field in agent_field_map.items():
            if key in normalized_name:
                state["agent_progression"][field] = completed
                updated = True
                break

        if not updated:
            state["agent_progression"][f"{agent_name}_completed"] = completed

    except Exception as e:
        logger.error("Failed to update agent progression: %s", e)


def _calculate_workflow_confidence(state: State) -> None:
    """Calculate overall workflow confidence."""
    try:
        agent_results = state.get("agent_results", {})

        if not agent_results:
            state["overall_confidence"] = 0.0
            return

        total_confidence = 0.0
        total_weight = 0.0

        agent_weights = {
            "alert": 0.2,
            "gatherer": 0.3,
            "analyzer": 0.3,
            "recommender": 0.2,
        }

        for agent_name, agent_data in agent_results.items():
            confidence = agent_data.get("results", {}).get("confidence", 0.0)

            weight = 0.25
            for key, w in agent_weights.items():
                if key in agent_name.lower():
                    weight = w
                    break

            total_confidence += confidence * weight
            total_weight += weight

        overall_confidence = (
            total_confidence / total_weight if total_weight > 0 else 0.0
        )
        state["overall_confidence"] = overall_confidence

    except Exception as e:
        logger.error("Failed to calculate workflow confidence: %s", e)
