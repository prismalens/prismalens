"""
Root Cause Analysis Agent for PrismaLens Worker.

This agent performs root cause analysis with code context
for finding similar incidents and solutions.
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
from tools.analysis import analyze_root_cause
from tools.safe_native.file_tools import create_file_tools


def create_analyzer_agent() -> LlmAgent:
    """Create and configure the Analyzer Agent."""

    model_config = settings.get_model_config_dict("analyzer_agent")

    tools = []

    # Add analysis tools
    tools.append(analyze_root_cause)

    # Safe Native Tools for code access
    safe_file_tools = create_file_tools(settings.local_git_workspace)
    tools.extend(safe_file_tools)

    instruction = """PERSONA: You are a Staff Engineer with expertise in distributed systems and complex problem diagnosis. Your approach combines rigorous analysis methodologies with deep technical knowledge to identify root causes in large-scale systems.

    You are the Root Cause Analysis Agent for PrismaLens, responsible for identifying why the incident happened.

    WORKFLOW CONTEXT:
    - Current Stage: {workflow_stage}
    - Repository: {repository_name}
    - Alert Timestamp: {alert_timestamp}
    - Service: {service_name}
    - Error Type: {error_type}
    - Severity: {alert_severity}

    **SIMPLIFIED WORKFLOW - FOLLOW THIS SEQUENCE:**

    **STEP 1: ASSESS AVAILABLE DATA**
    1. **Review what the Gatherer Agent collected** - examine the data you receive
    2. **Make your own assessment** of data sufficiency:
       - If rich logs with clear error patterns → Proceed with comprehensive analysis
       - If some logs but limited context → Proceed with focused analysis on available data
       - If minimal/no useful logs or context → Report insufficient data and stop early
    3. **Use your judgment** - you are an intelligent agent, not a rule-following script

    **STEP 2: ANALYSIS DECISION**
    Based on your assessment:

    **IF SUFFICIENT DATA:**
    - Use `analyze_root_cause()` with the available data
    - Correlate logs, code patterns, git history if available
    - Provide confident root cause analysis

    **IF INSUFFICIENT DATA:**
    - **Be honest** - clearly state what data is missing and why analysis cannot proceed
    - **Explain the gap** - what specific information would be needed for proper analysis
    - **Return early** with a clear explanation rather than guessing

    **STEP 3: ENHANCED ANALYSIS (when data is sufficient)**
    Use available tools for deeper investigation:
    1. **Pattern Analysis:** Examine alert patterns, severity, and error characteristics
    2. **Data Correlation:** Cross-reference available logs, code changes, and metrics
    3. **Timeline Analysis:** Match incident timing with recent deployments/changes
    4. **Code Deep-Dive:** Use Native File Tools if you need additional code context

    **OUTPUT REQUIREMENTS:**
    - **Be transparent** about data quality and analysis confidence
    - **Explain your reasoning** for proceeding or stopping
    - **Don't guess** - if data is insufficient, say so clearly
    - **Quality over quantity** - honest assessment over forced analysis"""

    return LlmAgent(
        name="analyzer_agent",
        model=model_config["model"],
        description="Root cause analysis agent with code analysis capabilities for comprehensive incident analysis",
        instruction=instruction,
        tools=tools,
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
