#!/usr/bin/env python3
"""
PrismaLens Worker - BullMQ Worker for Google ADK Agent Execution

This worker consumes jobs from a Redis queue and executes Google ADK agents
for incident analysis. It supports:
- Job priority processing
- Concurrent job execution (Enterprise)
- Progress reporting
- Graceful shutdown
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

from agents import create_coordinator_agent
from database import DatabaseWriter
from database.writer import AnalysisResult, Recommendation

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

    # Redis connection
    redis_url: str = "redis://localhost:6379"

    # Worker configuration
    worker_concurrency: int = 1
    edition: str = "COMMUNITY"
    dev_mode: bool = False

    # Agent configuration
    google_api_key: str = ""

    # Database configuration
    database_url: str = "file:../../../api/prisma/dev.db"


class AnalysisJobData:
    """Job data for analysis requests."""

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
    """BullMQ Worker for PrismaLens analysis jobs."""

    def __init__(self, settings: WorkerSettings):
        self.settings = settings
        self.running = False
        self.logger = logger.bind(
            edition=settings.edition,
            concurrency=settings.worker_concurrency,
        )
        self.db_writer = DatabaseWriter(settings.database_url)

    async def process_job(
        self,
        job_data: dict[str, Any],
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """Process a single analysis job using Google ADK agents."""
        data = AnalysisJobData(job_data)
        job_logger = self.logger.bind(
            alert_id=data.alert_id,
            analysis_run_id=data.analysis_run_id,
            service=data.service_name,
        )

        job_logger.info("Starting analysis job")

        # Update analysis status to running
        self.db_writer.update_analysis_status(
            data.analysis_run_id,
            "running",
            started_at=datetime.now(timezone.utc),
        )

        try:
            # Report initial progress
            if progress_callback:
                await progress_callback(0, "Initializing agent workflow...")

            # Create the coordinator agent (SequentialAgent)
            coordinator = create_coordinator_agent()

            # Create session service
            session_service = InMemorySessionService()

            # Create a session with initial state from job data
            session = await session_service.create_session(
                app_name="prismalens",
                user_id=f"worker_{data.analysis_run_id}",
                state={
                    # Alert context
                    "alert_id": data.alert_id,
                    "analysis_run_id": data.analysis_run_id,
                    "alert_data": data.alert_data,
                    "alert_timestamp": data.alert_timestamp,
                    "service_name": data.service_name,
                    "alert_severity": data.alert_severity,
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

            # Prepare the initial message with alert data
            initial_message = self._format_initial_message(data)

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
                        "alert_agent_active": (30, "Validating alert..."),
                        "alert_agent_completed": (40, "Alert validated"),
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
            result = self._build_result(data, final_state, final_response)

            job_logger.info(
                "Analysis job completed",
                success=True,
                confidence=result.get("findings", {}).get("confidence", 0),
            )

            if progress_callback:
                await progress_callback(100, "Complete")

            # Write result to database
            db_recommendations = [
                Recommendation(
                    title=rec.get("title", "Recommendation"),
                    description=rec.get("description"),
                    priority=rec.get("severity", "medium"),
                    category=rec.get("category"),
                )
                for rec in result.get("recommendations", [])
            ]

            db_result = AnalysisResult(
                analysis_run_id=data.analysis_run_id,
                status="completed",
                summary=result.get("findings", {}).get("rootCause"),
                root_cause=result.get("findings", {}).get("rootCause"),
                recommendations=db_recommendations,
            )
            self.db_writer.write_result(db_result)

            # Update alert status to resolved
            self.db_writer.update_alert_status(data.alert_id, "resolved")

            return result

        except Exception as e:
            job_logger.error("Analysis job failed", error=str(e), exc_info=True)

            # Write failure to database
            db_result = AnalysisResult(
                analysis_run_id=data.analysis_run_id,
                status="failed",
                error=str(e),
            )
            self.db_writer.write_result(db_result)

            return {
                "success": False,
                "analysisRunId": data.analysis_run_id,
                "error": str(e),
                "errorType": type(e).__name__,
            }

    def _format_initial_message(self, data: AnalysisJobData) -> str:
        """Format the initial message for the agent workflow."""
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

    def _build_result(
        self,
        data: AnalysisJobData,
        state: dict[str, Any],
        final_response: Any,
    ) -> dict[str, Any]:
        """Build the final result from agent workflow outputs."""
        # Extract agent results from state
        agent_results = state.get("agent_results", {})
        tool_executions = state.get("tool_executions", [])
        overall_confidence = state.get("overall_confidence", 0.0)

        # Extract recommendations from state
        recommendations = state.get("recommendations", [])

        # Build structured findings
        findings = {
            "rootCause": self._extract_root_cause(agent_results, state),
            "confidence": overall_confidence,
            "analysisMethod": "multi_agent_sequential",
            "dataSourcesUsed": self._extract_data_sources(tool_executions),
            "agentProgression": state.get("agent_progression", {}),
        }

        # Format recommendations
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

        # If no recommendations from state, extract from final response
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

    def _extract_root_cause(
        self,
        agent_results: dict[str, Any],
        state: dict[str, Any],
    ) -> str:
        """Extract root cause from analyzer agent results."""
        # Try to get from analyzer agent output
        analyzer_result = agent_results.get("analyzer_agent", {})
        if analyzer_result:
            analysis = analyzer_result.get("results", {}).get("analysis", {})
            causes = analysis.get("potential_causes", [])
            if causes:
                return causes[0].get("cause", "Root cause analysis completed")

        # Fallback to workflow stage
        stage = state.get("workflow_stage", "unknown")
        if stage == "workflow_completed":
            return "Analysis workflow completed - review recommendations for details"

        return "Root cause analysis in progress or incomplete"

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

    async def start(self) -> None:
        """Start the worker."""
        self.running = True
        self.logger.info(
            "Starting PrismaLens worker",
            redis_url=self.settings.redis_url,
        )

        # Check for Redis connection
        try:
            import redis.asyncio as redis

            client = redis.from_url(self.settings.redis_url)
            await client.ping()
            self.logger.info("Connected to Redis")
            await client.close()
        except Exception as e:
            self.logger.error("Failed to connect to Redis", error=str(e))
            if not self.settings.dev_mode:
                raise

        # In dev mode, just poll for work
        if self.settings.dev_mode:
            self.logger.info("Running in development mode (polling)")
            while self.running:
                await asyncio.sleep(1)
            return

        # Production mode: Use BullMQ
        try:
            from bullmq import Worker

            async def job_handler(job: Any, token: str | None = None) -> dict[str, Any]:
                """BullMQ job handler with progress support."""
                async def progress_callback(percent: int, message: str) -> None:
                    if hasattr(job, "updateProgress"):
                        await job.updateProgress({"percent": percent, "message": message})

                return await self.process_job(job.data, progress_callback)

            worker = Worker(
                "analysis",
                job_handler,
                {
                    "connection": self.settings.redis_url,
                    "concurrency": self.settings.worker_concurrency,
                },
            )

            self.logger.info("BullMQ worker started")

            # Keep running until shutdown
            while self.running:
                await asyncio.sleep(1)

            # Graceful shutdown
            await worker.close()

        except ImportError:
            self.logger.warning(
                "BullMQ not available, falling back to polling mode"
            )
            while self.running:
                await asyncio.sleep(1)

    def stop(self) -> None:
        """Stop the worker gracefully."""
        self.logger.info("Stopping worker...")
        self.running = False


async def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="PrismaLens Worker")
    parser.add_argument("--dev", action="store_true", help="Run in development mode")
    args = parser.parse_args()

    settings = WorkerSettings()
    if args.dev:
        settings.dev_mode = True

    worker = PrismaLensWorker(settings)

    # Handle signals for graceful shutdown
    loop = asyncio.get_event_loop()

    def signal_handler() -> None:
        worker.stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    try:
        await worker.start()
    except KeyboardInterrupt:
        worker.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
