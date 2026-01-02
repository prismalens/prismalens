"""
Executor abstraction for dual-mode job execution.

This module provides a unified interface for job execution with two backends:
- RegularExecutor: In-process async execution with HTTP job submission (no Redis)
- QueueExecutor: Redis-backed BullMQ execution for horizontal scaling

Inspired by n8n's execution mode architecture.
"""

import asyncio
import uuid
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Callable, Coroutine

import structlog
from aiohttp import web

logger = structlog.get_logger("prismalens.executor")


class WorkerMode(str, Enum):
    """Worker execution mode."""

    REGULAR = "regular"  # In-process async, no Redis required
    QUEUE = "queue"  # Redis-backed BullMQ


class JobStatus(str, Enum):
    """Job execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BaseExecutor(ABC):
    """Abstract base class for job executors."""

    @abstractmethod
    async def start(self) -> None:
        """Start the executor."""
        ...

    @abstractmethod
    async def stop(self, timeout: float = 30.0) -> None:
        """Stop the executor gracefully."""
        ...

    @abstractmethod
    def get_running_job_ids(self) -> list[str]:
        """Get list of currently running job IDs."""
        ...

    @abstractmethod
    def get_stats(self) -> dict[str, Any]:
        """Get executor statistics."""
        ...

    @property
    @abstractmethod
    def mode(self) -> WorkerMode:
        """Get the executor mode."""
        ...


# Type alias for job handler function
JobHandler = Callable[[dict[str, Any], Callable[[int, str], Coroutine[Any, Any, None]] | None], Coroutine[Any, Any, dict[str, Any]]]


class RegularExecutor(BaseExecutor):
    """
    In-process async execution with HTTP job submission endpoint.

    This executor runs jobs directly in the worker process using asyncio.
    Jobs are submitted via HTTP POST to /jobs endpoint.
    Concurrency is controlled via asyncio.Semaphore.

    No Redis required - suitable for local development.
    """

    def __init__(
        self,
        handler: JobHandler,
        max_concurrent: int = 5,
        host: str = "0.0.0.0",
        port: int = 8082,
    ):
        self._handler = handler
        self._max_concurrent = max_concurrent
        self._host = host
        self._port = port

        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._running_jobs: dict[str, asyncio.Task[dict[str, Any]]] = {}
        self._job_results: dict[str, dict[str, Any]] = {}

        # Statistics
        self._jobs_processed = 0
        self._jobs_failed = 0

        # HTTP server
        self._app: web.Application | None = None
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

        self._logger = logger.bind(mode="regular", max_concurrent=max_concurrent)

    @property
    def mode(self) -> WorkerMode:
        return WorkerMode.REGULAR

    async def start(self) -> None:
        """Start the HTTP server for job submission."""
        self._logger.info("Starting regular executor", host=self._host, port=self._port)

        self._app = web.Application()
        self._app.router.add_post("/jobs", self._handle_submit_job)
        self._app.router.add_get("/jobs", self._handle_list_jobs)
        self._app.router.add_get("/jobs/{job_id}", self._handle_get_job)
        self._app.router.add_delete("/jobs/{job_id}", self._handle_cancel_job)

        self._runner = web.AppRunner(self._app)
        await self._runner.setup()

        self._site = web.TCPSite(self._runner, self._host, self._port)
        await self._site.start()

        self._logger.info("Regular executor started", url=f"http://{self._host}:{self._port}")

    async def stop(self, timeout: float = 30.0) -> None:
        """Stop the executor and wait for in-flight jobs."""
        self._logger.info("Stopping regular executor", timeout=timeout, running_jobs=len(self._running_jobs))

        # Stop accepting new jobs
        if self._site:
            await self._site.stop()

        # Wait for running jobs to complete
        if self._running_jobs:
            self._logger.info("Waiting for running jobs to complete", count=len(self._running_jobs))

            try:
                # Wait with timeout for all running jobs
                tasks = list(self._running_jobs.values())
                done, pending = await asyncio.wait(tasks, timeout=timeout)

                if pending:
                    self._logger.warning("Cancelling jobs that didn't complete in time", count=len(pending))
                    for task in pending:
                        task.cancel()
            except Exception as e:
                self._logger.error("Error waiting for jobs", error=str(e))

        # Cleanup
        if self._runner:
            await self._runner.cleanup()

        self._logger.info("Regular executor stopped")

    def get_running_job_ids(self) -> list[str]:
        """Get list of currently running job IDs."""
        return list(self._running_jobs.keys())

    def get_stats(self) -> dict[str, Any]:
        """Get executor statistics."""
        return {
            "mode": self.mode.value,
            "max_concurrent": self._max_concurrent,
            "running_jobs": len(self._running_jobs),
            "jobs_processed": self._jobs_processed,
            "jobs_failed": self._jobs_failed,
            "semaphore_available": self._semaphore._value,
        }

    async def _handle_submit_job(self, request: web.Request) -> web.Response:
        """Handle POST /jobs - submit a new job."""
        try:
            job_data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

        # Generate job ID if not provided
        job_id = job_data.get("investigationId") or str(uuid.uuid4())

        # Check if job is already running
        if job_id in self._running_jobs:
            return web.json_response(
                {"error": "Job already running", "jobId": job_id},
                status=409,
            )

        # Start job in background
        task = asyncio.create_task(self._run_job(job_id, job_data))
        self._running_jobs[job_id] = task

        self._logger.info("Job submitted", job_id=job_id)

        return web.json_response(
            {
                "jobId": job_id,
                "status": "accepted",
                "message": "Job submitted successfully",
            },
            status=202,
        )

    async def _handle_list_jobs(self, request: web.Request) -> web.Response:
        """Handle GET /jobs - list running jobs."""
        jobs = [
            {"jobId": job_id, "status": "running"}
            for job_id in self._running_jobs.keys()
        ]
        return web.json_response({"jobs": jobs, "count": len(jobs)})

    async def _handle_get_job(self, request: web.Request) -> web.Response:
        """Handle GET /jobs/{job_id} - get job status."""
        job_id = request.match_info["job_id"]

        if job_id in self._running_jobs:
            return web.json_response({"jobId": job_id, "status": "running"})

        if job_id in self._job_results:
            result = self._job_results[job_id]
            return web.json_response({
                "jobId": job_id,
                "status": "completed" if result.get("success") else "failed",
                "result": result,
            })

        return web.json_response({"error": "Job not found"}, status=404)

    async def _handle_cancel_job(self, request: web.Request) -> web.Response:
        """Handle DELETE /jobs/{job_id} - cancel a running job."""
        job_id = request.match_info["job_id"]

        if job_id not in self._running_jobs:
            return web.json_response({"error": "Job not found or not running"}, status=404)

        task = self._running_jobs[job_id]
        task.cancel()

        self._logger.info("Job cancelled", job_id=job_id)

        return web.json_response({"jobId": job_id, "status": "cancelled"})

    async def _run_job(self, job_id: str, job_data: dict[str, Any]) -> dict[str, Any]:
        """Run a job with semaphore-based concurrency control."""
        self._logger.info("Job starting", job_id=job_id)

        try:
            async with self._semaphore:
                self._logger.debug("Acquired semaphore", job_id=job_id)

                # Create progress callback
                async def progress_callback(percent: int, message: str) -> None:
                    self._logger.debug("Job progress", job_id=job_id, percent=percent, message=message)

                # Run the job handler
                result = await self._handler(job_data, progress_callback)

                self._jobs_processed += 1
                self._logger.info("Job completed", job_id=job_id, success=result.get("success", True))

                # Store result for later retrieval
                self._job_results[job_id] = result

                return result

        except asyncio.CancelledError:
            self._logger.warning("Job cancelled", job_id=job_id)
            self._jobs_failed += 1
            return {"success": False, "error": "Job was cancelled"}

        except Exception as e:
            self._logger.error("Job failed", job_id=job_id, error=str(e))
            self._jobs_failed += 1
            result = {"success": False, "error": str(e)}
            self._job_results[job_id] = result
            return result

        finally:
            # Remove from running jobs
            self._running_jobs.pop(job_id, None)


class QueueExecutor(BaseExecutor):
    """
    Redis-backed BullMQ execution for horizontal scaling.

    This executor polls a Redis queue for jobs using BullMQ.
    Multiple workers can process jobs concurrently.

    Requires Redis - suitable for production deployments.
    """

    def __init__(
        self,
        redis_url: str,
        queue_name: str,
        handler: JobHandler,
        concurrency: int = 5,
    ):
        self._redis_url = redis_url
        self._queue_name = queue_name
        self._handler = handler
        self._concurrency = concurrency

        self._worker: Any = None  # BullMQ Worker
        self._running_jobs: dict[str, Any] = {}

        # Statistics
        self._jobs_processed = 0
        self._jobs_failed = 0

        self._logger = logger.bind(mode="queue", queue=queue_name, concurrency=concurrency)

    @property
    def mode(self) -> WorkerMode:
        return WorkerMode.QUEUE

    async def start(self) -> None:
        """Start the BullMQ worker."""
        self._logger.info("Starting queue executor", redis_url=self._redis_url)

        try:
            from bullmq import Worker

            async def job_processor(job: Any, token: str | None = None) -> dict[str, Any]:
                """BullMQ job processor."""
                job_id = job.id or str(uuid.uuid4())
                self._running_jobs[job_id] = job

                try:
                    # Create progress callback
                    async def progress_callback(percent: int, message: str) -> None:
                        if hasattr(job, "updateProgress"):
                            await job.updateProgress({"percent": percent, "message": message})

                    result = await self._handler(job.data, progress_callback)
                    self._jobs_processed += 1
                    return result

                except Exception as e:
                    self._logger.error("Job failed", job_id=job_id, error=str(e))
                    self._jobs_failed += 1
                    raise

                finally:
                    self._running_jobs.pop(job_id, None)

            self._worker = Worker(
                self._queue_name,
                job_processor,
                {
                    "connection": self._redis_url,
                    "concurrency": self._concurrency,
                },
            )

            self._logger.info("Queue executor started")

        except ImportError:
            self._logger.error("BullMQ not installed. Install with: uv add bullmq")
            raise

    async def stop(self, timeout: float = 30.0) -> None:
        """Stop the BullMQ worker gracefully."""
        self._logger.info("Stopping queue executor", timeout=timeout)

        if self._worker:
            # Close worker (this will wait for running jobs)
            await self._worker.close()

        self._logger.info("Queue executor stopped")

    def get_running_job_ids(self) -> list[str]:
        """Get list of currently running job IDs."""
        return list(self._running_jobs.keys())

    def get_stats(self) -> dict[str, Any]:
        """Get executor statistics."""
        return {
            "mode": self.mode.value,
            "queue_name": self._queue_name,
            "concurrency": self._concurrency,
            "running_jobs": len(self._running_jobs),
            "jobs_processed": self._jobs_processed,
            "jobs_failed": self._jobs_failed,
        }


def create_executor(
    mode: WorkerMode | str,
    handler: JobHandler,
    *,
    # Regular mode options
    max_concurrent: int = 5,
    host: str = "0.0.0.0",
    port: int = 8082,
    # Queue mode options
    redis_url: str = "",
    queue_name: str = "investigation",
    concurrency: int = 5,
) -> BaseExecutor:
    """
    Factory function to create the appropriate executor based on mode.

    Args:
        mode: Worker mode ('regular' or 'queue')
        handler: Job handler function
        max_concurrent: Max concurrent jobs for regular mode
        host: HTTP server host for regular mode
        port: HTTP server port for regular mode
        redis_url: Redis URL for queue mode
        queue_name: Queue name for queue mode
        concurrency: Worker concurrency for queue mode

    Returns:
        Configured executor instance
    """
    if isinstance(mode, str):
        mode = WorkerMode(mode)

    if mode == WorkerMode.REGULAR:
        return RegularExecutor(
            handler=handler,
            max_concurrent=max_concurrent,
            host=host,
            port=port,
        )
    else:
        if not redis_url:
            raise ValueError("redis_url is required for queue mode")

        return QueueExecutor(
            redis_url=redis_url,
            queue_name=queue_name,
            handler=handler,
            concurrency=concurrency,
        )
