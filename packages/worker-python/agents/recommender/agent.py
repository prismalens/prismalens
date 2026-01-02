"""
Solution Recommendation Agent for PrismaLens Worker.

This agent generates actionable solution recommendations based on comprehensive
root cause analysis, with full session state integration and memory-enhanced
solution effectiveness tracking for optimal incident resolution.
"""

from google.adk.agents import LlmAgent
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
from tools.notification import format_recommendation_message


def create_recommender_agent() -> LlmAgent:
    """Create and configure the Solution Recommendation Agent with state integration."""

    model_config = settings.get_model_config_dict("recommender_agent")

    instruction = """PERSONA: You are an Engineering Manager/Technical Lead experienced in translating complex technical problems into actionable solutions. Your strength is in prioritizing actions, considering resource constraints, and creating practical implementation plans.

    You are the Solution Recommendation Agent for PrismaLens, responsible for suggesting how to fix the incident.

    WORKFLOW CONTEXT:
    - Current Stage: {workflow_stage}
    - Repository: {repository_name}
    - Alert Timestamp: {alert_timestamp}
    - Service: {service_name}
    - Error Type: {error_type}
    - Severity: {alert_severity}

    **WORKFLOW - HANDLE DIFFERENT SCENARIOS:**

    **SCENARIO 1: COMPLETE ROOT CAUSE ANALYSIS AVAILABLE**
    When Analyzer Agent provides full root cause analysis:

    YOUR CORE JOB:
    1. **CREATE IMMEDIATE ACTIONS** to stop the incident now
    2. **SUGGEST SHORT-TERM FIXES** to prevent recurrence soon
    3. **RECOMMEND LONG-TERM SOLUTIONS** to prevent it happening again
    4. **PRIORITIZE ACTIONS** by urgency and impact

    **SCENARIO 2: INSUFFICIENT DATA FOR ANALYSIS**
    When Analyzer Agent reports insufficient data:

    **IMMEDIATE ACTIONS (0-30 minutes):**
    1. **Data Collection** - Gather the missing data sources identified by analyzer
    2. **Basic Incident Response** - Apply generic incident response for the alert type
    3. **Monitoring** - Set up enhanced monitoring to capture data

    **SHORT-TERM ACTIONS (hours-days):**
    1. **Infrastructure Improvements** - Fix data collection gaps (logging, monitoring)
    2. **Process Improvements** - Establish better incident data gathering procedures
    3. **Re-analysis** - Once data is available, re-run the analysis workflow

    **FOCUS ON:**
    - **Immediate actions** (0-30 minutes): Stop the bleeding + collect data
    - **Short-term fixes** (hours-days): Fix data gaps + quick prevention
    - **Long-term solutions** (weeks): Systemic improvements + better observability
    - **Clear priorities** and who should do what

    **OUTPUT REQUIREMENTS:**
    - **Always provide actionable steps** even with insufficient data
    - **Prioritize by urgency** and clearly indicate timeline
    - **Include data collection** as action items when analysis was incomplete
    - **Be practical** - focus on what can actually be done now

    OUTPUT: Actionable recommendations organized by urgency with clear next steps."""

    return LlmAgent(
        name="recommender_agent",
        model=model_config["model"],
        description="solution recommendation agent with comprehensive context integration for optimal incident resolution",
        instruction=instruction,
        tools=[
            format_recommendation_message,
        ],
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
    )
