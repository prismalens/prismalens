"""
Health and metrics server for PrismaLens Worker.

Provides endpoints for:
- Liveness checks (/health)
- Readiness checks (/ready)
- Prometheus metrics (/metrics)
"""

import asyncio
from typing import Any

import structlog
from aiohttp import web
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    Info,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

from executor import BaseExecutor, WorkerMode

logger = structlog.get_logger("prismalens.health")


# Prometheus metrics
WORKER_INFO = Info("prismalens_worker", "Worker information")
JOBS_PROCESSED = Counter(
    "prismalens_worker_jobs_processed_total",
    "Total number of jobs processed",
    ["status"],
)
JOBS_ACTIVE = Gauge(
    "prismalens_worker_active_jobs",
    "Number of currently active jobs",
)
JOB_DURATION = Histogram(
    "prismalens_worker_job_duration_seconds",
    "Job processing duration in seconds",
    buckets=[1, 5, 10, 30, 60, 120, 300, 600],
)


class HealthServer:
    """
    Health and metrics server using aiohttp.

    Endpoints:
    - GET /health - Liveness probe (always 200 if server is running)
    - GET /ready - Readiness probe (checks executor and API connectivity)
    - GET /metrics - Prometheus metrics
    """

    def __init__(
        self,
        port: int,
        executor: BaseExecutor,
        api_url: str,
        redis_url: str | None = None,
    ):
        self._port = port
        self._executor = executor
        self._api_url = api_url
        self._redis_url = redis_url

        self._app: web.Application | None = None
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

        self._logger = logger.bind(port=port, mode=executor.mode.value)

        # Initialize worker info metric
        WORKER_INFO.info({
            "mode": executor.mode.value,
            "version": "0.1.0",
        })

    async def start(self) -> None:
        """Start the health server."""
        self._logger.info("Starting health server")

        self._app = web.Application()
        self._app.router.add_get("/health", self._handle_health)
        self._app.router.add_get("/ready", self._handle_ready)
        self._app.router.add_get("/metrics", self._handle_metrics)

        self._runner = web.AppRunner(self._app)
        await self._runner.setup()

        self._site = web.TCPSite(self._runner, "0.0.0.0", self._port)
        await self._site.start()

        self._logger.info("Health server started", url=f"http://0.0.0.0:{self._port}")

    async def stop(self) -> None:
        """Stop the health server."""
        self._logger.info("Stopping health server")

        if self._site:
            await self._site.stop()

        if self._runner:
            await self._runner.cleanup()

        self._logger.info("Health server stopped")

    async def _handle_health(self, request: web.Request) -> web.Response:
        """
        Liveness probe - returns 200 if server is running.

        This is a basic liveness check. If this endpoint is not responding,
        the container/process should be restarted.
        """
        return web.json_response({
            "status": "ok",
            "mode": self._executor.mode.value,
        })

    async def _handle_ready(self, request: web.Request) -> web.Response:
        """
        Readiness probe - checks if worker is ready to process jobs.

        Checks:
        - API connectivity (always)
        - Redis connectivity (queue mode only)
        """
        checks: dict[str, dict[str, Any]] = {}
        all_healthy = True

        # Check API connectivity
        api_healthy = await self._check_api()
        checks["api"] = {
            "healthy": api_healthy,
            "url": self._api_url,
        }
        if not api_healthy:
            all_healthy = False

        # Check Redis connectivity (queue mode only)
        if self._executor.mode == WorkerMode.QUEUE and self._redis_url:
            redis_healthy = await self._check_redis()
            checks["redis"] = {
                "healthy": redis_healthy,
                "url": self._redis_url.split("@")[-1] if "@" in self._redis_url else self._redis_url,
            }
            if not redis_healthy:
                all_healthy = False

        # Get executor stats
        stats = self._executor.get_stats()

        response_data = {
            "status": "ready" if all_healthy else "not_ready",
            "mode": self._executor.mode.value,
            "checks": checks,
            "stats": stats,
        }

        status_code = 200 if all_healthy else 503
        return web.json_response(response_data, status=status_code)

    async def _handle_metrics(self, request: web.Request) -> web.Response:
        """
        Prometheus metrics endpoint.

        Returns metrics in Prometheus text format.
        """
        # Update active jobs gauge
        JOBS_ACTIVE.set(len(self._executor.get_running_job_ids()))

        # Get executor stats and update metrics
        stats = self._executor.get_stats()
        if "jobs_processed" in stats:
            # Note: We can't easily update Counter from external value
            # These are tracked by the executor and reported here
            pass

        metrics_output = generate_latest()
        return web.Response(
            body=metrics_output,
            content_type=CONTENT_TYPE_LATEST,
        )

    async def _check_api(self) -> bool:
        """Check API connectivity."""
        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._api_url}/health",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as response:
                    return response.status == 200
        except Exception as e:
            self._logger.warning("API health check failed", error=str(e))
            return False

    async def _check_redis(self) -> bool:
        """Check Redis connectivity."""
        try:
            import redis.asyncio as redis

            client = redis.from_url(self._redis_url)
            await client.ping()
            await client.close()
            return True
        except Exception as e:
            self._logger.warning("Redis health check failed", error=str(e))
            return False


# Helper functions for recording metrics from the worker

def record_job_started() -> None:
    """Record that a job has started."""
    JOBS_ACTIVE.inc()


def record_job_completed(duration_seconds: float, success: bool = True) -> None:
    """Record that a job has completed."""
    JOBS_ACTIVE.dec()
    JOB_DURATION.observe(duration_seconds)
    JOBS_PROCESSED.labels(status="success" if success else "failed").inc()


def record_job_failed(duration_seconds: float) -> None:
    """Record that a job has failed."""
    record_job_completed(duration_seconds, success=False)
