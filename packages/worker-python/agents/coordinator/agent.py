"""
Coordinator Agent for PrismaLens Worker.

This module contains the SequentialAgent coordinator that orchestrates
the entire incident analysis workflow by managing the sequence of
alert, gatherer, analyzer, and recommender agents.
"""

from typing import Any

from google.adk.agents import SequentialAgent

from agents.alert.agent import create_alert_agent
from agents.analyzer.agent import create_analyzer_agent
from agents.gatherer.agent import create_gatherer_agent
from agents.recommender.agent import create_recommender_agent
from callbacks import after_agent_callback, before_agent_callback


def create_coordinator_agent(additional_tools: list[Any] | None = None) -> SequentialAgent:
    """
    Create the coordinator agent using SequentialAgent for proper workflow orchestration.

    This coordinator manages the sequential execution of all workflow agents:
    1. Alert Agent - validates and normalizes incoming alerts
    2. Gatherer Agent - collects contextual data and code analysis
    3. Analyzer Agent - performs root cause analysis
    4. Recommender Agent - generates actionable recommendations

    Args:
        additional_tools: Optional list of additional tools (from integrations) to add
                         to the gatherer agent for external data collection.

    Returns:
        SequentialAgent configured with the complete workflow
    """
    # Create all sub-agents
    # The gatherer agent receives additional tools from integrations (GitHub, Prometheus, etc.)
    alert_agent = create_alert_agent()
    gatherer_agent = create_gatherer_agent(additional_tools=additional_tools or [])
    analyzer_agent = create_analyzer_agent()
    recommender_agent = create_recommender_agent()

    return SequentialAgent(
        name="coordinator_agent",
        description="PERSONA: Incident Commander with expertise in crisis management and workflow orchestration. Your role is to coordinate complex incident response processes with precision and maintain clear communication across all phases. | Sequential coordinator for PrismaLens incident analysis workflow",
        sub_agents=[
            alert_agent,
            gatherer_agent,
            analyzer_agent,
            recommender_agent,
        ],
        before_agent_callback=before_agent_callback,
        after_agent_callback=after_agent_callback,
    )
