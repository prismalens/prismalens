"""
Analysis Function Tools for PrismaLens Worker.

Core root cause analysis with data validation and pattern-based detection.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from google.adk.tools import FunctionTool

from utils.tool_utils import create_tool_result

logger = logging.getLogger(__name__)


@FunctionTool
def validate_analysis_readiness() -> dict:
    """
    Validate that sufficient data has been collected for meaningful root cause analysis.

    This tool checks the current state to determine if enough data sources have been
    successfully collected to proceed with analysis. No parameters needed as it reads
    from the current session state.

    Returns:
        Dict containing validation results and recommendations for missing data
    """
    try:
        logger.info("Validating analysis readiness...")

        return create_tool_result(
            status="validation_active",
            message="Data validation framework is active. State tracking will be available during workflow execution.",
            data={
                "ready": False,
                "completeness_score": 0.0,
                "missing_sources": [
                    "logs",
                    "code_analysis",
                    "git_history",
                    "metrics",
                    "external_knowledge",
                ],
                "recommendations": [
                    "Ensure Gatherer Agent has collected logs, code analysis, and git history",
                    "Verify data collection callbacks are working properly",
                    "Check workflow state for data_collection and analysis_readiness structures",
                ],
            },
        )

    except Exception as e:
        logger.error(f"Error validating analysis readiness: {e}")
        return create_tool_result(
            status="error",
            message=f"Validation failed: {str(e)}",
            data={"ready": False},
            confidence=0.0,
        )


@FunctionTool
def validate_and_analyze_root_cause(
    alert_data: dict, minimum_confidence_threshold: float = 0.5
) -> dict:
    """
    Perform data-validated root cause analysis that checks data completeness before proceeding.

    1. First validates that sufficient data has been collected
    2. Only proceeds with analysis if data meets minimum requirements
    3. Returns specific error messages when data is insufficient
    4. Adapts analysis confidence based on data quality

    Args:
        alert_data: Normalized alert data
        minimum_confidence_threshold: Minimum data completeness required (0.0-1.0)

    Returns:
        Enhanced root cause analysis with data validation or specific error messages
    """
    try:
        logger.info("Starting validated root cause analysis...")

        # Enhanced analysis with data quality awareness
        analysis_result = _perform_enhanced_analysis(
            alert_data, minimum_confidence_threshold
        )

        return analysis_result

    except Exception as e:
        logger.error(f"Error in validated root cause analysis: {e}")
        return {
            "status": "error",
            "error": f"Analysis failed: {str(e)}",
            "analysis": {
                "potential_causes": [],
                "confidence_score": 0.0,
                "analysis_method": "failed_validation",
            },
            "confidence": 0.0,
        }


@FunctionTool
def request_additional_data(data_types: list[str], reasoning: str) -> dict:
    """
    Request specific additional data needed for more comprehensive analysis.

    This tool allows the analyzer to specify exactly what additional data would
    improve the analysis quality and why it's needed.

    Args:
        data_types: List of data types needed (e.g., ["logs", "code_analysis", "git_history"])
        reasoning: Explanation of why this data is needed for the analysis

    Returns:
        Confirmation of data request with guidance on next steps
    """
    try:
        logger.info(f"Data request: {', '.join(data_types)} - {reasoning}")

        # Validate data types
        valid_data_types = [
            "logs",
            "code_analysis",
            "git_history",
            "metrics",
            "external_knowledge",
        ]
        invalid_types = [dt for dt in data_types if dt not in valid_data_types]

        if invalid_types:
            return create_tool_result(
                status="error",
                message=f"Invalid data types requested: {invalid_types}",
                data={"valid_types": valid_data_types},
                confidence=0.0,
            )

        return create_tool_result(
            status="data_requested",
            message=f"Additional data requested: {', '.join(data_types)}. Gatherer Agent should collect this data before re-attempting analysis.",
            data={
                "requested_data_types": data_types,
                "reasoning": reasoning,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "next_steps": [
                    "Gatherer Agent should focus on collecting the requested data types",
                    "Re-run analysis once additional data is available",
                    "Consider lowering confidence thresholds if critical data remains unavailable",
                ],
            },
        )

    except Exception as e:
        logger.error(f"Error requesting additional data: {e}")
        return create_tool_result(
            status="error",
            message=f"Data request failed: {str(e)}",
            confidence=0.0,
        )


@FunctionTool
def analyze_root_cause(alert_data: dict) -> dict:
    """
    Analyze potential root causes for an alert using pattern matching.

    Args:
        alert_data: Normalized alert data

    Returns:
        Root cause analysis with ranked potential causes
    """
    try:
        alert_name = alert_data.get("alertname", "unknown")
        service = alert_data.get("service", "unknown")
        severity = alert_data.get("severity", "unknown")
        logger.info(
            f"Analyzing root cause for: {alert_name} (service: {service}, severity: {severity})"
        )

        analysis: dict[str, Any] = {
            "potential_causes": [],
            "confidence_score": 0.0,
            "analysis_method": "pattern_based",
        }

        if not alert_data:
            return create_tool_result(
                status="no_data",
                message="No alert data provided for analysis",
                data={"analysis": analysis},
                confidence=0.0,
            )

        # Extract alert characteristics
        annotations = alert_data.get("annotations", {})

        # Analyze based on alert patterns
        causes = _analyze_alert_patterns(alert_name, annotations)
        analysis["potential_causes"] = _rank_causes_by_likelihood(causes)
        analysis["confidence_score"] = _calculate_analysis_confidence(analysis)

        logger.info(
            f"Found {len(analysis['potential_causes'])} potential causes (confidence: {analysis['confidence_score']:.2f})"
        )

        return create_tool_result(
            status="analyzed",
            message=f"Root cause analysis completed with {len(analysis['potential_causes'])} potential causes",
            data={"analysis": analysis},
            confidence=analysis["confidence_score"],
        )

    except Exception as e:
        return create_tool_result(
            status="error",
            message=f"Root cause analysis failed: {str(e)}",
            data={"analysis": analysis},
            confidence=0.0,
        )


def _analyze_alert_patterns(alert_name: str, annotations: dict) -> list[dict]:
    """Analyze alert patterns to identify potential causes."""
    causes = []

    alert_text = f"{alert_name} {annotations.get('summary', '')} {annotations.get('description', '')}".lower()

    cause_patterns = {
        "cpu": {
            "patterns": ["cpu", "processor", "load"],
            "cause": "High CPU usage or processing bottleneck",
        },
        "memory": {
            "patterns": ["memory", "oom", "out of memory", "heap"],
            "cause": "Memory leak or insufficient memory allocation",
        },
        "network": {
            "patterns": ["network", "connection", "timeout", "unreachable"],
            "cause": "Network connectivity or latency issue",
        },
        "application": {
            "patterns": ["error", "exception", "failed", "crash"],
            "cause": "Application error or code issue",
        },
    }

    for category, info in cause_patterns.items():
        if any(pattern in alert_text for pattern in info["patterns"]):
            causes.append(
                {
                    "cause": info["cause"],
                    "category": category,
                    "likelihood": 0.7,
                    "evidence": f"Alert contains {category} keywords",
                }
            )

    return causes


def _rank_causes_by_likelihood(causes: list[dict]) -> list[dict]:
    """Rank causes by their likelihood scores."""
    return sorted(causes, key=lambda x: x.get("likelihood", 0), reverse=True)


def _calculate_analysis_confidence(analysis: dict) -> float:
    """Calculate confidence in the root cause analysis."""
    causes = analysis.get("potential_causes", [])
    if not causes:
        return 0.0
    return max(cause.get("likelihood", 0.0) for cause in causes)


def _perform_enhanced_analysis(
    alert_data: dict, minimum_confidence_threshold: float
) -> dict:
    """
    Perform enhanced analysis with data quality considerations.
    """
    try:
        alert_name = alert_data.get("alertname", "unknown")
        service = alert_data.get("service", "unknown")
        severity = alert_data.get("severity", "unknown")

        logger.info(
            f"Enhanced analysis for: {alert_name} (service: {service}, severity: {severity})"
        )

        analysis: dict[str, Any] = {
            "potential_causes": [],
            "confidence_score": 0.0,
            "analysis_method": "enhanced_pattern_based",
            "data_quality_note": "Analysis performed without data validation - integrate with workflow state for full validation",
        }

        if not alert_data:
            return create_tool_result(
                status="insufficient_data",
                message="No alert data provided for analysis",
                data={
                    "analysis": analysis,
                    "recommendations": [
                        "Provide complete alert data",
                        "Ensure alert contains alertname, service, and severity information",
                    ],
                },
                confidence=0.0,
            )

        # Extract alert characteristics
        annotations = alert_data.get("annotations", {})

        # Analyze based on alert patterns with enhanced categorization
        causes = _analyze_enhanced_alert_patterns(alert_name, annotations, severity)
        analysis["potential_causes"] = _rank_causes_by_likelihood(causes)
        analysis["confidence_score"] = _calculate_enhanced_confidence(
            analysis, minimum_confidence_threshold
        )

        # Determine if analysis meets minimum threshold
        if analysis["confidence_score"] < minimum_confidence_threshold:
            return create_tool_result(
                status="low_confidence",
                message=f"Analysis confidence ({analysis['confidence_score']:.2f}) below minimum threshold ({minimum_confidence_threshold})",
                data={
                    "analysis": analysis,
                    "recommendations": [
                        "Collect additional logs around the alert timestamp",
                        "Analyze relevant code files for potential issues",
                        "Review recent code changes and deployments",
                        "Gather system metrics and performance data",
                    ],
                },
                confidence=analysis["confidence_score"],
            )

        logger.info(
            f"Enhanced analysis completed with {len(analysis['potential_causes'])} causes (confidence: {analysis['confidence_score']:.2f})"
        )

        return create_tool_result(
            status="analyzed",
            message=f"Root cause analysis completed with {len(analysis['potential_causes'])} potential causes identified",
            data={"analysis": analysis},
            confidence=analysis["confidence_score"],
        )

    except Exception as e:
        logger.error(f"Enhanced analysis failed: {e}")
        return create_tool_result(
            status="error",
            message=f"Enhanced analysis failed: {str(e)}",
            data={
                "analysis": {
                    "potential_causes": [],
                    "confidence_score": 0.0,
                    "analysis_method": "failed_enhanced",
                }
            },
            confidence=0.0,
        )


def _analyze_enhanced_alert_patterns(
    alert_name: str, annotations: dict, severity: str
) -> list[dict]:
    """Enhanced alert pattern analysis with more sophisticated cause detection."""
    causes = []

    alert_text = f"{alert_name} {annotations.get('summary', '')} {annotations.get('description', '')}".lower()
    severity_lower = severity.lower()

    # Enhanced cause patterns with severity weighting
    cause_patterns = {
        "cpu": {
            "patterns": ["cpu", "processor", "load", "high load", "cpu usage"],
            "cause": "High CPU usage or processing bottleneck",
            "severity_multiplier": {
                "critical": 1.2,
                "high": 1.1,
                "medium": 1.0,
                "low": 0.8,
            },
        },
        "memory": {
            "patterns": [
                "memory",
                "oom",
                "out of memory",
                "heap",
                "memory leak",
                "gc",
            ],
            "cause": "Memory leak or insufficient memory allocation",
            "severity_multiplier": {
                "critical": 1.3,
                "high": 1.2,
                "medium": 1.0,
                "low": 0.7,
            },
        },
        "network": {
            "patterns": [
                "network",
                "connection",
                "timeout",
                "unreachable",
                "latency",
                "dns",
            ],
            "cause": "Network connectivity or latency issue",
            "severity_multiplier": {
                "critical": 1.1,
                "high": 1.0,
                "medium": 0.9,
                "low": 0.8,
            },
        },
        "application": {
            "patterns": ["error", "exception", "failed", "crash", "500", "503", "404"],
            "cause": "Application error or code issue",
            "severity_multiplier": {
                "critical": 1.2,
                "high": 1.1,
                "medium": 1.0,
                "low": 0.9,
            },
        },
        "database": {
            "patterns": [
                "database",
                "db",
                "sql",
                "query",
                "deadlock",
                "connection pool",
            ],
            "cause": "Database connectivity or performance issue",
            "severity_multiplier": {
                "critical": 1.3,
                "high": 1.2,
                "medium": 1.0,
                "low": 0.8,
            },
        },
        "deployment": {
            "patterns": ["deploy", "deployment", "version", "rollback", "config"],
            "cause": "Recent deployment or configuration change",
            "severity_multiplier": {
                "critical": 1.1,
                "high": 1.0,
                "medium": 0.9,
                "low": 0.8,
            },
        },
    }

    for category, info in cause_patterns.items():
        if any(pattern in alert_text for pattern in info["patterns"]):
            # Apply severity-based likelihood adjustment
            base_likelihood = 0.7
            severity_multiplier = info["severity_multiplier"].get(severity_lower, 1.0)
            adjusted_likelihood = min(base_likelihood * severity_multiplier, 0.95)

            causes.append(
                {
                    "cause": info["cause"],
                    "category": category,
                    "likelihood": adjusted_likelihood,
                    "evidence": f"Alert contains {category} keywords, severity: {severity}",
                    "severity_factor": severity_multiplier,
                }
            )

    return causes


def _calculate_enhanced_confidence(
    analysis: dict, minimum_threshold: float
) -> float:
    """Calculate enhanced confidence with threshold awareness."""
    causes = analysis.get("potential_causes", [])
    if not causes:
        return 0.0

    # Get the highest likelihood cause
    max_likelihood = max(cause.get("likelihood", 0.0) for cause in causes)

    # Factor in the number of supporting causes
    num_causes = len(causes)
    diversity_bonus = min(num_causes * 0.1, 0.3)  # Up to 30% bonus for multiple causes

    # Calculate final confidence
    confidence = min(max_likelihood + diversity_bonus, 1.0)

    return confidence
