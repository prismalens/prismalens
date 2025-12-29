"""
Data Gatherer Agent for PrismaLens Worker.

This agent collects contextual information from various sources using safe tools
with full session state awareness and memory-pattern recognition
to provide comprehensive, targeted data for root cause analysis.
"""

from datetime import datetime, timezone

from google.adk.agents import LlmAgent
from google.adk.tools.function_tool import FunctionTool
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
from tools.agent_communication import call_log_retriever_agent
from tools.github import create_github_tool
from tools.safe_native.ast_tools import create_ast_tools
from tools.safe_native.file_tools import create_file_tools
from tools.safe_native.repo_tools import create_repo_tools
from tools.safe_native.search_tools import create_search_tools


def get_current_time() -> str:
    """Get current UTC timestamp for temporal analysis."""
    return datetime.now(timezone.utc).isoformat()


def create_function_toolsets() -> list[FunctionTool]:
    """Create function tools for external data sources."""
    function_tools = []
    function_tools.append(FunctionTool(get_current_time))
    return function_tools


def create_gatherer_agent() -> LlmAgent:
    """Create and configure the Data Gatherer Agent with state integration."""

    model_config = settings.get_model_config_dict("gatherer_agent")

    tools = []

    # Initialize Safe Native Tools
    safe_file_tools = create_file_tools(settings.local_git_workspace)
    safe_search_tools = create_search_tools(settings.local_git_workspace)
    safe_ast_tools = create_ast_tools(settings.local_git_workspace)
    safe_repo_tools = create_repo_tools(settings.local_git_workspace)
    github_tools = create_github_tool()

    tools.extend(safe_file_tools)
    tools.extend(safe_search_tools)
    tools.extend(safe_ast_tools)
    tools.extend(safe_repo_tools)
    tools.extend(github_tools)

    # Add Function tools
    function_tools = create_function_toolsets()
    if function_tools:
        for toolset in function_tools:
            tools.append(toolset)

    # Add agent communication function tool
    tools.append(call_log_retriever_agent)

    instruction = """PERSONA: You are a Principal Software Engineer known for systematic debugging and code investigation. Your specialization is in using multiple analysis tools methodically to uncover complex system issues through code archaeology and pattern recognition.

    You are the Data Gatherer Agent for PrismaLens, responsible for orchestrating data collection and performing code analysis.

    WORKFLOW CONTEXT:
    - Current Stage: {workflow_stage}
    - Repository: {repository_name}
    - Alert Timestamp: {alert_timestamp}
    - Service: {service_name}
    - Error Type: {error_type}
    - Severity: {alert_severity}

    **WORKFLOW - FOLLOW THIS SEQUENCE:**

    YOUR CORE JOB:
    1. **COLLECT LOGS** using `call_log_retriever_agent(...)`
    2. **ANALYZE LOGS** and decide on Code Analysis strategy
    3. **PREPARE REPO** using `ensure_repo_locally(repository_name)` (CRITICAL STEP)
    4. **CODE ANALYSIS** using Native Tools (File, Search, AST)
        A. **EXPLORE** using `list_directory` and `read_file`
        B. **SEARCH** using `search_and_preview` (Preferred) or `search`
        C. **ANALYZE** using `scan_pattern` for structural matching
    5. **GET METADATA** using GitHub API (History, Blame, Issues)
        *   **Use `inspect_api("search term")`** to find relevant tools
        *   **Use `read_tool_manual("tool_name")`** to understand parameters
        *   **Use `call_github_api("tool_name", args)`** to execute
    6. **GATHER CONTEXT** to explain the incident

    **STEP 0: REPO PREPARATION (MANDATORY)**
    *   Before running any search/file tools, you MUST call `ensure_repo_locally("owner/repo")`.
    *   This clones the code so that tools can work on the local filesystem.

    **TOOL USAGE GUIDELINES:**

    *   **GITHUB API (UTCP Standard)**:
        *   Do NOT guess tool names. They are generated from the spec.
        *   Discovery: `inspect_api("commits")` -> returns list of tools.
        *   Execution: `call_github_api("repos_get_commits", {"owner": "...", "repo": "..."})`.

    *   **EFFICIENCY IS PARAMOUNT**:
        *   **PARALLEL EXECUTION**: You can and SHOULD call multiple tools in a single turn.
        *   Prefer `search_and_preview(query)` over `search()` followed by `read_file()`.
        *   Do not blindly read huge lists of files. Use `list_directory` to understand layout first.

    **OUTPUT REQUIREMENTS:**
    - Explain your findings clearly.
    - Cite specific files and lines.
    - Connect the dots between Logs and Code.
"""

    return LlmAgent(
        name="gatherer_agent",
        model=model_config["model"],
        description="data collection agent with code analysis capabilities and context awareness for comprehensive incident analysis",
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
