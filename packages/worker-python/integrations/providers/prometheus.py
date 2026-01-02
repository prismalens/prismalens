"""Prometheus integration provider."""

import httpx
from typing import Any, Optional
from datetime import datetime, timedelta
import base64

from google.adk.tools import FunctionTool

from .base import BaseProvider, IntegrationContext


class PrometheusProvider(BaseProvider):
    """
    Prometheus integration provider.

    Provides tools for:
    - Running PromQL instant queries
    - Running PromQL range queries
    - Getting current alerts
    - Getting target health
    - Getting metric metadata
    """

    name = "prometheus"

    def __init__(self, context: IntegrationContext):
        super().__init__(context)
        self.base_url = context.get_config("baseUrl", "http://localhost:9090").rstrip("/")
        self.default_step = context.get_config("defaultStep", "1m")
        self.max_points = context.get_config("maxPoints", 1000)

    def _get_headers(self) -> dict[str, str]:
        """Get headers for Prometheus API requests."""
        headers = {"Accept": "application/json"}

        # Basic auth if credentials provided
        username = self.context.credentials.get("username")
        password = self.context.credentials.get("password") or self.context.credentials.get("apiKey")

        if username and password:
            auth = base64.b64encode(f"{username}:{password}".encode()).decode()
            headers["Authorization"] = f"Basic {auth}"
        elif password:
            # API key only (some Prometheus setups use Bearer)
            headers["Authorization"] = f"Bearer {password}"

        return headers

    async def health_check(self) -> bool:
        """Check Prometheus API connectivity."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/status/config",
                    headers=self._get_headers(),
                    timeout=10.0,
                )
                return response.status_code == 200
        except Exception as e:
            self.logger.error(f"Prometheus health check failed: {e}")
            return False

    def get_tools(self) -> list[FunctionTool]:
        """Get ADK tools for Prometheus integration."""
        return [
            FunctionTool(self.query_instant),
            FunctionTool(self.query_range),
            FunctionTool(self.get_alerts),
            FunctionTool(self.get_targets),
            FunctionTool(self.get_metric_metadata),
        ]

    async def query_instant(
        self,
        query: str,
        time: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Execute a PromQL instant query.

        Args:
            query: PromQL query string
            time: Evaluation timestamp (RFC3339 or Unix timestamp). Defaults to now.

        Returns:
            Dict with query results
        """
        try:
            params = {"query": query}
            if time:
                params["time"] = time

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/query",
                    headers=self._get_headers(),
                    params=params,
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"Prometheus API error: {response.status_code}",
                        "data": None,
                    }

                result = response.json()
                if result.get("status") != "success":
                    return {
                        "error": result.get("error", "Unknown error"),
                        "data": None,
                    }

                data = result.get("data", {})
                result_type = data.get("resultType")
                results = data.get("result", [])

                # Format results for readability
                formatted = []
                for item in results:
                    metric = item.get("metric", {})
                    value = item.get("value", [])

                    formatted.append({
                        "metric": metric,
                        "timestamp": value[0] if len(value) > 0 else None,
                        "value": value[1] if len(value) > 1 else None,
                    })

                return {
                    "query": query,
                    "result_type": result_type,
                    "count": len(formatted),
                    "results": formatted,
                }

        except Exception as e:
            self.logger.error(f"Failed to execute instant query: {e}")
            return {"error": str(e), "data": None}

    async def query_range(
        self,
        query: str,
        start: Optional[str] = None,
        end: Optional[str] = None,
        step: Optional[str] = None,
        duration_hours: int = 1,
    ) -> dict[str, Any]:
        """
        Execute a PromQL range query.

        Args:
            query: PromQL query string
            start: Start timestamp (RFC3339 or Unix). Defaults to (now - duration_hours).
            end: End timestamp (RFC3339 or Unix). Defaults to now.
            step: Query resolution step. Defaults to configured default.
            duration_hours: If start/end not provided, query last N hours.

        Returns:
            Dict with time series data
        """
        try:
            now = datetime.utcnow()
            if not end:
                end = now.isoformat() + "Z"
            if not start:
                start = (now - timedelta(hours=duration_hours)).isoformat() + "Z"

            params = {
                "query": query,
                "start": start,
                "end": end,
                "step": step or self.default_step,
            }

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/query_range",
                    headers=self._get_headers(),
                    params=params,
                    timeout=60.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"Prometheus API error: {response.status_code}",
                        "data": None,
                    }

                result = response.json()
                if result.get("status") != "success":
                    return {
                        "error": result.get("error", "Unknown error"),
                        "data": None,
                    }

                data = result.get("data", {})
                results = data.get("result", [])

                # Format results
                formatted = []
                for item in results:
                    metric = item.get("metric", {})
                    values = item.get("values", [])

                    # Limit points if too many
                    if len(values) > self.max_points:
                        step_size = len(values) // self.max_points
                        values = values[::step_size]

                    formatted.append({
                        "metric": metric,
                        "values": [
                            {"timestamp": v[0], "value": v[1]}
                            for v in values
                        ],
                        "point_count": len(values),
                    })

                return {
                    "query": query,
                    "start": start,
                    "end": end,
                    "step": step or self.default_step,
                    "series_count": len(formatted),
                    "results": formatted,
                }

        except Exception as e:
            self.logger.error(f"Failed to execute range query: {e}")
            return {"error": str(e), "data": None}

    async def get_alerts(
        self,
        filter_state: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Get currently firing alerts from Prometheus.

        Args:
            filter_state: Filter by state (firing, pending). None for all.

        Returns:
            Dict with alerts list
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/alerts",
                    headers=self._get_headers(),
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"Prometheus API error: {response.status_code}",
                        "alerts": [],
                    }

                result = response.json()
                if result.get("status") != "success":
                    return {
                        "error": result.get("error", "Unknown error"),
                        "alerts": [],
                    }

                alerts = result.get("data", {}).get("alerts", [])

                # Filter by state if requested
                if filter_state:
                    alerts = [a for a in alerts if a.get("state") == filter_state]

                formatted = [
                    {
                        "name": a.get("labels", {}).get("alertname", "unknown"),
                        "state": a.get("state"),
                        "severity": a.get("labels", {}).get("severity", "unknown"),
                        "labels": a.get("labels", {}),
                        "annotations": a.get("annotations", {}),
                        "active_at": a.get("activeAt"),
                        "value": a.get("value"),
                    }
                    for a in alerts
                ]

                # Group by severity
                by_severity = {}
                for alert in formatted:
                    sev = alert["severity"]
                    if sev not in by_severity:
                        by_severity[sev] = 0
                    by_severity[sev] += 1

                return {
                    "total_count": len(formatted),
                    "by_severity": by_severity,
                    "alerts": formatted,
                }

        except Exception as e:
            self.logger.error(f"Failed to get alerts: {e}")
            return {"error": str(e), "alerts": []}

    async def get_targets(
        self,
        state: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Get Prometheus scrape targets and their health.

        Args:
            state: Filter by state (active, dropped). None for all.

        Returns:
            Dict with targets list and health summary
        """
        try:
            params = {}
            if state:
                params["state"] = state

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/targets",
                    headers=self._get_headers(),
                    params=params,
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"Prometheus API error: {response.status_code}",
                        "targets": [],
                    }

                result = response.json()
                if result.get("status") != "success":
                    return {
                        "error": result.get("error", "Unknown error"),
                        "targets": [],
                    }

                data = result.get("data", {})
                active_targets = data.get("activeTargets", [])

                formatted = [
                    {
                        "job": t.get("labels", {}).get("job", "unknown"),
                        "instance": t.get("labels", {}).get("instance", "unknown"),
                        "health": t.get("health"),
                        "scrape_url": t.get("scrapeUrl"),
                        "last_scrape": t.get("lastScrape"),
                        "last_error": t.get("lastError") or None,
                        "labels": t.get("labels", {}),
                    }
                    for t in active_targets
                ]

                # Health summary
                health_summary = {"up": 0, "down": 0, "unknown": 0}
                for target in formatted:
                    health = target["health"]
                    if health in health_summary:
                        health_summary[health] += 1
                    else:
                        health_summary["unknown"] += 1

                return {
                    "total_count": len(formatted),
                    "health_summary": health_summary,
                    "targets": formatted,
                }

        except Exception as e:
            self.logger.error(f"Failed to get targets: {e}")
            return {"error": str(e), "targets": []}

    async def get_metric_metadata(
        self,
        metric: Optional[str] = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        """
        Get metadata about metrics.

        Args:
            metric: Specific metric name to get metadata for. None for all.
            limit: Maximum metrics to return when getting all.

        Returns:
            Dict with metric metadata
        """
        try:
            params = {"limit": str(limit)}
            if metric:
                params["metric"] = metric

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/metadata",
                    headers=self._get_headers(),
                    params=params,
                    timeout=30.0,
                )

                if response.status_code != 200:
                    return {
                        "error": f"Prometheus API error: {response.status_code}",
                        "metadata": {},
                    }

                result = response.json()
                if result.get("status") != "success":
                    return {
                        "error": result.get("error", "Unknown error"),
                        "metadata": {},
                    }

                metadata = result.get("data", {})

                # Format metadata
                formatted = {}
                for metric_name, meta_list in metadata.items():
                    if meta_list:
                        meta = meta_list[0]
                        formatted[metric_name] = {
                            "type": meta.get("type"),
                            "help": meta.get("help"),
                            "unit": meta.get("unit", ""),
                        }

                return {
                    "count": len(formatted),
                    "metadata": formatted,
                }

        except Exception as e:
            self.logger.error(f"Failed to get metric metadata: {e}")
            return {"error": str(e), "metadata": {}}
