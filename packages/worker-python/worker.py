#!/usr/bin/env python3
"""
PrismaLens Worker - BullMQ Worker for Google ADK Agent Execution

This worker consumes jobs from a Redis queue and executes Google ADK agents
for incident investigation. It supports:
- Incident-centric investigation (not just alerts)
- Job priority processing
- Concurrent job execution (Enterprise)
- Progress reporting
- Graceful shutdown

Updated for incident-centric schema:
- Works on incidents (collections of correlated alerts)
- Creates investigations for each incident analysis
- Tracks agent and tool executions
- Updates incident timeline
"""

import argparse
import asyncio
import signal
import sys
from datetime import datetime, timezone
from typing import Any

import structlog
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic_settings import BaseSettings, SettingsConfigDict

from config.settings import settings
from config.internal_client import InternalApiClient
from integrations import IntegrationLoader

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger("prismalens.worker")


class WorkerSettings(BaseSettings):
    """Worker configuration from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="PRISMALENS_",
        env_file=".env",
        env_file_encoding="utf-8",
    )

    # Redis connection (for queue mode)
    redis_url: str = "redis://localhost:6379"

    # Worker configuration
    worker_mode: str = "regular"  # 'regular' or 'queue'
    worker_concurrency: int = 5
    worker_health_port: int = 8081
    worker_job_port: int = 8082
    graceful_shutdown_timeout: int = 30
    edition: str = "COMMUNITY"

    # Agent configuration
    google_api_key: str = ""


class InvestigationJobData:
    """Job data for investigation requests (incident-centric)."""

    def __init__(self, data: dict[str, Any]):
        # New incident-centric fields
        self.incident_id: str = data.get("incidentId", "")
        self.investigation_id: str = data.get("investigationId", "")
        self.priority: str = data.get("priority", "normal")
        self.context: dict[str, Any] = data.get("context", {})

        # Incident data
        self.incident_data: dict[str, Any] = data.get("incidentData", {})
        self.incident_number: int = self.incident_data.get("number", 0)
        self.incident_title: str = self.incident_data.get("title", "Unknown Incident")
        self.incident_severity: str = self.incident_data.get("severity", "medium")
        self.service_name: str = self.incident_data.get("serviceName", "unknown")
        self.service_id: str | None = self.incident_data.get("serviceId")

        # Alerts included in this incident
        self.alerts: list[dict[str, Any]] = data.get("alerts", [])

        # Integration contexts from API
        self.integrations: list[dict[str, Any]] = data.get("integrations", [])

        # Timestamp
        self.triggered_at: str = self.incident_data.get(
            "triggeredAt", datetime.now(timezone.utc).isoformat()
        )


# Legacy alias for backwards compatibility
class AnalysisJobData:
    """Legacy job data for analysis requests (alert-centric)."""

    def __init__(self, data: dict[str, Any]):
        self.alert_id: str = data.get("alertId", "")
        self.analysis_run_id: str = data.get("analysisRunId", "")
        self.priority: str = data.get("priority", "normal")
        self.context: dict[str, Any] = data.get("context", {})

        # Extract alert data from context
        self.alert_data: dict[str, Any] = data.get("alertData", {})
        self.service_name: str = self.alert_data.get("service", "unknown")
        self.alert_severity: str = self.alert_data.get("severity", "medium")
        self.alert_timestamp: str = self.alert_data.get(
            "timestamp", datetime.now(timezone.utc).isoformat()
        )


class PrismaLensWorker:
    """BullMQ Worker for PrismaLens investigation jobs."""

    def __init__(self, worker_settings: WorkerSettings):
        self.worker_settings = worker_settings
        self.running = False
        self.logger = logger.bind(
            edition=worker_settings.edition,
            concurrency=worker_settings.worker_concurrency,
        )
        # Use the global settings internal_client for API calls
        self.internal_client: InternalApiClient = settings.internal_client

    async def process_investigation_job(
        self,
        job_data: dict[str, Any],
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """Process an investigation job for an incident using Google ADK agents."""
        data = InvestigationJobData(job_data)
        job_logger = self.logger.bind(
            incident_id=data.incident_id,
            investigation_id=data.investigation_id,
            incident_number=data.incident_number,
            service=data.service_name,
        )

        job_logger.info("Starting investigation job")

        # Update investigation status to running via internal API
        started_at = datetime.now(timezone.utc)
        self.internal_client.update_investigation_status(
            data.investigation_id,
            "running",
            started_at=started_at.isoformat(),
        )

        # Add timeline entry for investigation start via internal API
        self.internal_client.add_timeline_entry({
            "incidentId": data.incident_id,
            "type": "investigation_started",
            "title": "AI Investigation Started",
            "description": f"Starting automated investigation for incident #{data.incident_number}",
            "source": "ai_worker",
            "metadata": {"investigationId": data.investigation_id},
        })

        try:
            # Report initial progress
            if progress_callback:
                await progress_callback(0, "Initializing agent workflow...")

            # Load integrations from job data
            integration_loader = None
            integration_tools = []
            if data.integrations:
                job_logger.info(
                    "Loading integrations",
                    integration_count=len(data.integrations),
                    types=[i.get("type") for i in data.integrations],
                )
                integration_loader = IntegrationLoader(data.integrations)
                integration_tools = integration_loader.get_tools()
                job_logger.info(
                    "Integration tools loaded",
                    tool_count=len(integration_tools),
                    available_integrations=integration_loader.get_available_integrations(),
                )

            # Lazy import: only load agent when investigation begins
            from agents import create_coordinator_agent

            # Create the coordinator agent (SequentialAgent) with integration tools
            coordinator = create_coordinator_agent(additional_tools=integration_tools)

            # Create session service
            session_service = InMemorySessionService()

            # Create a session with initial state from job data
            session = await session_service.create_session(
                app_name="prismalens",
                user_id=f"worker_{data.investigation_id}",
                state={
                    # Incident context (new)
                    "incident_id": data.incident_id,
                    "investigation_id": data.investigation_id,
                    "incident_number": data.incident_number,
                    "incident_title": data.incident_title,
                    "incident_severity": data.incident_severity,
                    "incident_data": data.incident_data,
                    "alerts": data.alerts,
                    # Service context
                    "service_name": data.service_name,
                    "triggered_at": data.triggered_at,
                    # Workflow tracking
                    "workflow_stage": "initializing",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                },
            )

            if progress_callback:
                await progress_callback(10, "Starting agent workflow...")

            # Create the Runner
            runner = Runner(
                agent=coordinator,
                app_name="prismalens",
                session_service=session_service,
            )

            # Prepare the initial message with incident data
            initial_message = self._format_incident_message(data)

            job_logger.info("Running coordinator agent", session_id=session.id)

            if progress_callback:
                await progress_callback(20, "Running alert validation...")

            # Run the agent workflow
            final_response = None
            async for event in runner.run_async(
                user_id=session.user_id,
                session_id=session.id,
                new_message=types.Content(
                    role="user",
                    parts=[types.Part(text=initial_message)],
                ),
            ):
                # Track progress through workflow stages
                if hasattr(event, "content") and event.content:
                    final_response = event.content

                # Update progress based on workflow stage
                current_state = session.state
                stage = current_state.get("workflow_stage", "unknown")

                if progress_callback:
                    progress_map = {
                        "alert_agent_active": (30, "Validating alerts..."),
                        "alert_agent_completed": (40, "Alerts validated"),
                        "gatherer_agent_active": (45, "Gathering context data..."),
                        "gatherer_agent_completed": (60, "Context gathered"),
                        "analyzer_agent_active": (65, "Analyzing root cause..."),
                        "analyzer_agent_completed": (80, "Analysis complete"),
                        "recommender_agent_active": (85, "Generating recommendations..."),
                        "recommender_agent_completed": (95, "Recommendations ready"),
                        "workflow_completed": (100, "Workflow complete"),
                    }
                    if stage in progress_map:
                        pct, msg = progress_map[stage]
                        await progress_callback(pct, msg)

            # Extract final results from session state
            final_state = session.state

            # Build result from agent outputs
            result = self._build_investigation_result(data, final_state, final_response)

            job_logger.info(
                "Investigation job completed",
                success=True,
                confidence=result.get("findings", {}).get("confidence", 0),
            )

            if progress_callback:
                await progress_callback(100, "Complete")

            # Build agent execution data from state for API
            agent_executions = self._build_agent_executions_for_api(final_state)

            # Build recommendations for API
            findings = result.get("findings", {})
            api_recommendations = [
                {
                    "title": rec.get("title", "Recommendation"),
                    "description": rec.get("description"),
                    "priority": rec.get("priority", rec.get("severity", "medium")),
                    "category": rec.get("category"),
                    "urgency": rec.get("urgency"),
                    "actionable": rec.get("actionable", True),
                    "estimatedEffort": rec.get("estimatedEffort", rec.get("effort")),
                }
                for rec in result.get("recommendations", [])
            ]

            # Write investigation result via internal API
            api_result = {
                "status": "completed",
                "incidentId": data.incident_id,
                "summary": findings.get("summary") or findings.get("rootCause"),
                "rootCause": findings.get("rootCause"),
                "rootCauseCategory": self._categorize_root_cause(
                    findings.get("rootCause", "")
                ),
                "confidence": findings.get("confidence"),
                "dataQuality": findings.get("dataQuality"),
                "analysisMethod": findings.get(
                    "analysisMethod", "multi_agent_sequential"
                ),
                "dataSourcesUsed": findings.get("dataSourcesUsed"),
                "agentProgression": findings.get("agentProgression"),
                "agentExecutions": agent_executions,
                "recommendations": api_recommendations,
            }
            self.internal_client.write_investigation_result(
                data.investigation_id, api_result
            )

            return result

        except Exception as e:
            job_logger.error("Investigation job failed", error=str(e), exc_info=True)

            # Write failure via internal API
            api_result = {
                "status": "failed",
                "incidentId": data.incident_id,
                "error": str(e),
            }
            self.internal_client.write_investigation_result(
                data.investigation_id, api_result
            )

            # Add timeline entry for failure via internal API
            self.internal_client.add_timeline_entry({
                "incidentId": data.incident_id,
                "type": "investigation_failed",
                "title": "AI Investigation Failed",
                "description": str(e),
                "source": "ai_worker",
                "metadata": {
                    "investigationId": data.investigation_id,
                    "error": str(e),
                },
            })

            return {
                "success": False,
                "investigationId": data.investigation_id,
                "incidentId": data.incident_id,
                "error": str(e),
                "errorType": type(e).__name__,
            }

    # Legacy method for backwards compatibility
    async def process_job(
        self,
        job_data: dict[str, Any],
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """Process a job - routes to appropriate handler based on job type."""
        # Check if this is new incident-centric job or legacy alert job
        if "incidentId" in job_data and "investigationId" in job_data:
            return await self.process_investigation_job(job_data, progress_callback)
        else:
            # Legacy alert-centric job
            return await self._process_legacy_job(job_data, progress_callback)

    async def _process_legacy_job(
        self,
        job_data: dict[str, Any],
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """
        Process a legacy alert-centric analysis job.

        DEPRECATED: This method is deprecated and will be removed.
        New jobs should use the incident-centric format with incidentId
        and investigationId fields.
        """
        data = AnalysisJobData(job_data)
        job_logger = self.logger.bind(
            alert_id=data.alert_id,
            analysis_run_id=data.analysis_run_id,
            service=data.service_name,
        )

        job_logger.warning(
            "Processing legacy alert-centric job - this format is deprecated. "
            "Please migrate to incident-centric jobs with incidentId/investigationId."
        )

        # Legacy jobs are no longer supported - return error
        return {
            "success": False,
            "analysisRunId": data.analysis_run_id,
            "error": "Legacy alert-centric jobs are deprecated. "
            "Please use incident-centric format with incidentId and investigationId.",
            "errorType": "DeprecationError",
        }

    def _format_incident_message(self, data: InvestigationJobData) -> str:
        """Format the initial message for incident investigation."""
        alerts_summary = ""
        for i, alert in enumerate(data.alerts[:5], 1):  # Limit to first 5 alerts
            alerts_summary += f"""
Alert {i}:
- Title: {alert.get('title', 'Unknown')}
- Severity: {alert.get('severity', 'unknown')}
- Source: {alert.get('source', 'unknown')}
- Status: {alert.get('status', 'triggered')}
"""

        return f"""Investigate the following incident:

Incident ID: {data.incident_id}
Incident Number: #{data.incident_number}
Investigation ID: {data.investigation_id}

Incident Details:
- Title: {data.incident_title}
- Severity: {data.incident_severity}
- Service: {data.service_name}
- Triggered At: {data.triggered_at}
- Alert Count: {len(data.alerts)}

Related Alerts:
{alerts_summary}

Additional Context: {data.incident_data}

Please process this incident through the complete investigation workflow:
1. Validate and normalize all related alerts
2. Gather contextual information (logs, code, git history, metrics)
3. Perform root cause analysis considering all alerts as potentially related
4. Generate actionable recommendations for resolution

Provide comprehensive analysis with:
- Root cause identification and category (code, config, infrastructure, external)
- Confidence score (0.0 to 1.0)
- Prioritized recommendations with effort estimates"""

    def _format_alert_message(self, data: AnalysisJobData) -> str:
        """Format the initial message for legacy alert analysis."""
        alert = data.alert_data

        return f"""Analyze the following incident alert:

Alert ID: {data.alert_id}
Analysis Run ID: {data.analysis_run_id}

Alert Details:
- Name: {alert.get('alertname', 'Unknown')}
- Service: {data.service_name}
- Severity: {data.alert_severity}
- Timestamp: {data.alert_timestamp}
- Status: {alert.get('status', 'firing')}

Labels: {alert.get('labels', {})}
Annotations: {alert.get('annotations', {})}

Please process this alert through the complete workflow:
1. Validate and normalize the alert data
2. Gather contextual information (logs, code, git history)
3. Perform root cause analysis
4. Generate actionable recommendations

Provide comprehensive analysis with confidence scores and prioritized recommendations."""

    def _build_investigation_result(
        self,
        data: InvestigationJobData,
        state: dict[str, Any],
        final_response: Any,
    ) -> dict[str, Any]:
        """Build the final result from investigation workflow outputs."""
        agent_results = state.get("agent_results", {})
        tool_executions = state.get("tool_executions", [])
        overall_confidence = state.get("overall_confidence", 0.0)

        recommendations = state.get("recommendations", [])

        findings = {
            "rootCause": self._extract_root_cause(agent_results, state),
            "summary": self._extract_summary(agent_results, state),
            "confidence": overall_confidence,
            "analysisMethod": "multi_agent_sequential",
            "dataSourcesUsed": self._extract_data_sources(tool_executions),
            "agentProgression": state.get("agent_progression", {}),
        }

        formatted_recommendations = []
        for i, rec in enumerate(recommendations):
            formatted_recommendations.append({
                "id": f"rec-{data.investigation_id}-{i}",
                "title": rec.get("title", f"Recommendation {i+1}"),
                "description": rec.get("description", ""),
                "priority": rec.get("priority", "medium"),
                "category": rec.get("category", "general"),
                "urgency": rec.get("urgency", "short_term"),
                "actionable": True,
                "estimatedEffort": rec.get("effort", "unknown"),
            })

        if not formatted_recommendations and final_response:
            formatted_recommendations.append({
                "id": f"rec-{data.investigation_id}-0",
                "title": "Review Agent Analysis",
                "description": str(final_response)[:500] if final_response else "Analysis completed",
                "priority": "medium",
                "category": "analysis",
                "urgency": "short_term",
                "actionable": True,
            })

        return {
            "success": True,
            "investigationId": data.investigation_id,
            "incidentId": data.incident_id,
            "incidentNumber": data.incident_number,
            "findings": findings,
            "recommendations": formatted_recommendations,
            "metadata": {
                "processingTime": self._calculate_processing_time(state),
                "toolsExecuted": len(tool_executions),
                "agentsCompleted": sum(
                    1 for v in state.get("agent_progression", {}).values() if v
                ),
                "alertCount": len(data.alerts),
            },
        }

    def _build_legacy_result(
        self,
        data: AnalysisJobData,
        state: dict[str, Any],
        final_response: Any,
    ) -> dict[str, Any]:
        """Build the final result from legacy alert analysis."""
        agent_results = state.get("agent_results", {})
        tool_executions = state.get("tool_executions", [])
        overall_confidence = state.get("overall_confidence", 0.0)

        recommendations = state.get("recommendations", [])

        findings = {
            "rootCause": self._extract_root_cause(agent_results, state),
            "confidence": overall_confidence,
            "analysisMethod": "multi_agent_sequential",
            "dataSourcesUsed": self._extract_data_sources(tool_executions),
            "agentProgression": state.get("agent_progression", {}),
        }

        formatted_recommendations = []
        for i, rec in enumerate(recommendations):
            formatted_recommendations.append({
                "id": f"rec-{data.analysis_run_id}-{i}",
                "title": rec.get("title", f"Recommendation {i+1}"),
                "description": rec.get("description", ""),
                "severity": rec.get("priority", "medium"),
                "category": rec.get("category", "general"),
                "actionable": True,
                "estimatedEffort": rec.get("effort", "unknown"),
            })

        if not formatted_recommendations and final_response:
            formatted_recommendations.append({
                "id": f"rec-{data.analysis_run_id}-0",
                "title": "Review Agent Analysis",
                "description": str(final_response)[:500] if final_response else "Analysis completed",
                "severity": "medium",
                "category": "analysis",
                "actionable": True,
            })

        return {
            "success": True,
            "analysisRunId": data.analysis_run_id,
            "alertId": data.alert_id,
            "findings": findings,
            "recommendations": formatted_recommendations,
            "metadata": {
                "processingTime": self._calculate_processing_time(state),
                "toolsExecuted": len(tool_executions),
                "agentsCompleted": sum(
                    1 for v in state.get("agent_progression", {}).values() if v
                ),
            },
        }

    def _build_agent_executions_for_api(
        self, state: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Build agent execution records as dictionaries for API submission."""
        agent_executions = []
        state_executions = state.get("agent_executions", [])
        tool_executions = state.get("tool_executions", [])

        for agent_exec in state_executions:
            agent_name = agent_exec.get("agent_name", "unknown")

            # Find tool executions for this agent
            agent_tools = [
                {
                    "toolName": t.get("tool_name", "unknown"),
                    "toolCategory": self._categorize_tool(t.get("tool_name", "")),
                    "arguments": t.get("arguments"),
                    "result": t.get("result"),
                    "status": t.get("status", "success"),
                    "executionTimeMs": int(
                        t.get("execution_time_seconds", 0) * 1000
                    ),
                    "confidence": t.get("confidence"),
                }
                for t in tool_executions
                if t.get("agent_name") == agent_name
            ]

            started_at = agent_exec.get("started_at")
            completed_at = agent_exec.get("completed_at")
            execution_time_ms = None

            if agent_exec.get("execution_time_seconds"):
                execution_time_ms = int(agent_exec["execution_time_seconds"] * 1000)

            agent_executions.append({
                "agentName": agent_name,
                "agentType": "llm",
                "status": agent_exec.get("status", "completed"),
                "startedAt": started_at,
                "completedAt": completed_at,
                "executionTimeMs": execution_time_ms,
                "toolExecutions": agent_tools,
            })

        return agent_executions

    def _categorize_tool(self, tool_name: str) -> str:
        """Categorize a tool by its name."""
        tool_name_lower = tool_name.lower()
        if "file" in tool_name_lower or "read" in tool_name_lower:
            return "file"
        elif "search" in tool_name_lower or "grep" in tool_name_lower:
            return "search"
        elif "git" in tool_name_lower or "github" in tool_name_lower:
            return "github"
        elif "log" in tool_name_lower or "render" in tool_name_lower:
            return "logs"
        elif "analyze" in tool_name_lower or "analysis" in tool_name_lower:
            return "analysis"
        return "other"

    def _categorize_root_cause(self, root_cause: str) -> str:
        """Categorize root cause into standard categories."""
        root_cause_lower = root_cause.lower()
        if any(word in root_cause_lower for word in ["code", "bug", "error", "exception", "null", "undefined"]):
            return "code"
        elif any(word in root_cause_lower for word in ["config", "configuration", "setting", "environment", "variable"]):
            return "config"
        elif any(word in root_cause_lower for word in ["infrastructure", "server", "network", "memory", "cpu", "disk", "database"]):
            return "infrastructure"
        elif any(word in root_cause_lower for word in ["external", "third-party", "api", "upstream", "downstream"]):
            return "external"
        return "unknown"

    def _extract_root_cause(
        self,
        agent_results: dict[str, Any],
        state: dict[str, Any],
    ) -> str:
        """Extract root cause from analyzer agent results."""
        analyzer_result = agent_results.get("analyzer_agent", {})
        if analyzer_result:
            analysis = analyzer_result.get("results", {}).get("analysis", {})
            causes = analysis.get("potential_causes", [])
            if causes:
                return causes[0].get("cause", "Root cause analysis completed")

        stage = state.get("workflow_stage", "unknown")
        if stage == "workflow_completed":
            return "Analysis workflow completed - review recommendations for details"

        return "Root cause analysis in progress or incomplete"

    def _extract_summary(
        self,
        agent_results: dict[str, Any],
        state: dict[str, Any],
    ) -> str:
        """Extract summary from agent results."""
        # Try to get from analyzer agent
        analyzer_result = agent_results.get("analyzer_agent", {})
        if analyzer_result:
            summary = analyzer_result.get("results", {}).get("summary")
            if summary:
                return summary

        # Fallback to root cause
        return self._extract_root_cause(agent_results, state)

    def _extract_data_sources(self, tool_executions: list[dict]) -> list[str]:
        """Extract unique data sources used during analysis."""
        sources = set()
        for execution in tool_executions:
            tool_name = execution.get("tool_name", "")
            if "log" in tool_name.lower():
                sources.add("logs")
            elif "git" in tool_name.lower() or "github" in tool_name.lower():
                sources.add("git_history")
            elif "search" in tool_name.lower() or "file" in tool_name.lower():
                sources.add("code_analysis")
            elif "render" in tool_name.lower():
                sources.add("render_logs")
        return list(sources)

    def _calculate_processing_time(self, state: dict[str, Any]) -> float:
        """Calculate total processing time in seconds."""
        started_at = state.get("started_at")
        if not started_at:
            return 0.0

        try:
            start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            end = datetime.now(timezone.utc)
            return (end - start).total_seconds()
        except Exception:
            return 0.0

    def stop(self) -> None:
        """Stop the worker gracefully."""
        self.logger.info("Stopping worker...")
        self.running = False


async def main() -> None:
    """
    Main entry point for PrismaLens Worker.

    Supports two execution modes:
    - regular: In-process async execution with HTTP job submission (no Redis)
    - queue: Redis-backed BullMQ execution for horizontal scaling
    """
    from executor import create_executor, WorkerMode
    from health import HealthServer

    parser = argparse.ArgumentParser(description="PrismaLens Worker")
    parser.add_argument(
        "--mode",
        choices=["regular", "queue"],
        default=None,
        help="Execution mode: 'regular' (HTTP, no Redis) or 'queue' (BullMQ, requires Redis)",
    )
    args = parser.parse_args()

    # Initialize settings
    worker_settings = WorkerSettings()

    # CLI --mode flag overrides environment variable
    if args.mode:
        worker_settings.worker_mode = args.mode

    # Create worker instance for job processing
    worker = PrismaLensWorker(worker_settings)

    # Log startup info
    logger.info(
        "Starting PrismaLens Worker",
        mode=worker_settings.worker_mode,
        concurrency=worker_settings.worker_concurrency,
        edition=worker_settings.edition,
    )

    # Validate configuration
    if worker_settings.worker_mode == "queue" and not worker_settings.redis_url:
        logger.error("REDIS_URL is required for queue mode")
        sys.exit(1)

    # Create executor based on mode
    executor = create_executor(
        mode=worker_settings.worker_mode,
        handler=worker.process_job,
        # Regular mode options
        max_concurrent=worker_settings.worker_concurrency,
        host="0.0.0.0",
        port=worker_settings.worker_job_port,
        # Queue mode options
        redis_url=worker_settings.redis_url,
        queue_name="investigation",
        concurrency=worker_settings.worker_concurrency,
    )

    # Create health server
    health_server = HealthServer(
        port=worker_settings.worker_health_port,
        executor=executor,
        api_url=settings.api_url,
        redis_url=worker_settings.redis_url if worker_settings.worker_mode == "queue" else None,
    )

    # Shutdown handling
    shutdown_event = asyncio.Event()

    async def shutdown() -> None:
        logger.info("Initiating graceful shutdown...")

        # Stop executor with timeout
        await executor.stop(timeout=worker_settings.graceful_shutdown_timeout)

        # Stop health server
        await health_server.stop()

        shutdown_event.set()

    # Signal handlers for graceful shutdown
    loop = asyncio.get_running_loop()

    def signal_handler() -> None:
        logger.info("Received shutdown signal")
        asyncio.create_task(shutdown())

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    try:
        # Start health server
        await health_server.start()

        # Start executor
        await executor.start()

        logger.info(
            "Worker started successfully",
            mode=worker_settings.worker_mode,
            health_port=worker_settings.worker_health_port,
            job_port=worker_settings.worker_job_port if worker_settings.worker_mode == "regular" else None,
        )

        # Wait for shutdown signal
        await shutdown_event.wait()

    except KeyboardInterrupt:
        await shutdown()
    except Exception as e:
        logger.error("Worker failed to start", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
