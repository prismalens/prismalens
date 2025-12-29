"""
Alert Processing Agent for PrismaLens Worker.

This agent receives and processes incoming alerts from monitoring systems,
normalizes the data, and prepares it for further analysis with full
session state integration and memory-correlation.
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
from tools.validation import (
    extract_alert_metadata,
    extract_service_info,
    normalize_alert_format,
    validate_alert_data,
)


def create_alert_agent() -> LlmAgent:
    """Create and configure the Alert Processing Agent with state integration."""

    model_config = settings.get_model_config_dict("alert_agent")

    instruction = """PERSONA: You are a Site Reliability Engineer (SRE) specializing in alert triage and monitoring systems. You have deep experience with incident classification, alert correlation, and noise reduction in high-volume environments. Your approach is methodical and focuses on extracting precise, actionable data from alert signals.

    You are the Alert Processing Agent for PrismaLens, responsible for processing and validating incoming alerts.

    WORKFLOW CONTEXT:
    - Current Stage: {workflow_stage}
    - Service: {service_name}
    - Severity: {alert_severity}
    - Timestamp: {alert_timestamp}

    YOUR CORE JOB:
    1. **VALIDATE** the incoming alert data for completeness
    2. **NORMALIZE** the alert format for consistent processing
    3. **EXTRACT** key information from the alert, including:
        - Service information
        - Metadata

    PROCESS:
    1. **VALIDATE** the alert using validate_alert_data tool
    2. **NORMALIZE** the format using normalize_alert_format tool
    3. **EXTRACT SERVICE INFO** using extract_service_info tool (including repository_name)
    4. **EXTRACT METADATA** using extract_alert_metadata tool

    OUTPUT: Organized alert data with critical field populated to facilitate further analysis."""

    return LlmAgent(
        name="alert_agent",
        model=model_config["model"],
        description="alert processing agent with state management and memory integration for comprehensive incident analysis",
        instruction=instruction,
        tools=[
            validate_alert_data,
            normalize_alert_format,
            extract_alert_metadata,
            extract_service_info,
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
