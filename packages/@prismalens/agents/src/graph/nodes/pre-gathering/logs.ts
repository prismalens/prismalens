/**
 * Log preview fetching for pre-gathering phase
 *
 * Uses headless MCP tool calls to fetch logs from whatever logging
 * integration is configured (Render, Datadog, Loki, etc.).
 */

import { Logger } from "@prismalens/logger";
import type { LogEntry, LogPreviewContext } from "../../../types/index.js";
import { callMCPTool, findBundleForCapability } from "./mcp-caller.js";
import type { GatheringContext, GatherResult } from "./types.js";

const logger = new Logger({ context: "PreGather:Logs" });

/**
 * Check if logging integration is available.
 * Checks both explicit logging integrations AND MCP bundles
 * that provide log-related tools (e.g., render-mcp).
 */
export function hasLoggingIntegration(ctx: GatheringContext): boolean {
	// Check explicit logging integrations
	const hasExplicit = ctx.integrations.some(
		(i) =>
			i.type === "logging" ||
			i.type === "loki" ||
			i.type === "elasticsearch" ||
			i.type === "datadog",
	);
	if (hasExplicit) return true;

	// Check if render integration is available (provides logs via MCP)
	return ctx.integrations.some((i) => i.type === "render");
}

/**
 * Preview recent error logs for the incident context.
 * Uses headless MCP calls to fetch logs from the configured integration.
 * Returns null if no logging integration is available.
 */
export async function previewLogs(
	ctx: GatheringContext,
): Promise<GatherResult<LogPreviewContext | null>> {
	const startTime = Date.now();

	try {
		const { incidentTime } = ctx;

		// Check for logging integration
		if (!hasLoggingIntegration(ctx)) {
			logger.debug("No logging integration available");
			return {
				success: true,
				data: null,
				durationMs: Date.now() - startTime,
			};
		}

		logger.debug("Previewing logs", {
			incidentTime: incidentTime.toISOString(),
			serviceId: ctx.serviceId,
		});

		// Define time range: 30 minutes before incident to now
		const timeRangeStart = new Date(
			incidentTime.getTime() - 30 * 60 * 1000,
		).toISOString();
		const timeRangeEnd = new Date().toISOString();

		let errorLogs: LogEntry[] = [];
		let source: string | undefined;

		// Try to fetch logs via MCP if registry is available
		if (ctx.registry) {
			const bundleName = await findBundleForCapability(ctx.registry, "logs");

			if (bundleName) {
				const result = await callMCPTool(
					ctx.registry,
					bundleName,
					"list_service_logs",
					{
						serviceId: ctx.serviceId,
						since: timeRangeStart,
						until: timeRangeEnd,
						limit: 50,
					},
					ctx.integrations,
				);

				if (result.success && result.data) {
					errorLogs = parseLogEntries(result.data);
					source = bundleName;
				}
			}
		}

		logger.debug("Log preview complete", {
			errorLogCount: errorLogs.length,
			source,
		});

		return {
			success: true,
			data: {
				errorLogs,
				timeRange: {
					start: timeRangeStart,
					end: timeRangeEnd,
				},
				source,
			},
			durationMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error("Failed to preview logs", { error: errorMessage });
		return {
			success: false,
			data: null,
			error: errorMessage,
			durationMs: Date.now() - startTime,
		};
	}
}

/**
 * Parse raw MCP log output into structured LogEntry array.
 * Handles both JSON and plain text log formats.
 */
function parseLogEntries(rawOutput: string): LogEntry[] {
	const entries: LogEntry[] = [];

	// Try JSON parse first (structured log output)
	try {
		const parsed = JSON.parse(rawOutput);
		if (Array.isArray(parsed)) {
			for (const item of parsed) {
				if (typeof item === "object" && item !== null) {
					const entry: LogEntry = {
						message: item.message ?? item.text ?? String(item),
						timestamp: item.timestamp ?? new Date().toISOString(),
						level: normalizeLogLevel(item.level ?? item.severity ?? "info"),
						service: item.service ?? item.serviceName,
						traceId: item.traceId ?? item.trace_id,
					};
					entries.push(entry);
				}
			}
			return entries.filter((e) => e.level === "error" || e.level === "warn");
		}
	} catch {
		// Not JSON — parse as text lines
	}

	// Parse as text lines (each line is a log entry)
	const lines = rawOutput.split("\n").filter((l) => l.trim());
	for (const line of lines) {
		const level = inferLogLevel(line);
		if (level === "error" || level === "warn") {
			entries.push({
				message: line.trim(),
				timestamp: new Date().toISOString(),
				level,
			});
		}
	}

	return entries.slice(0, 50);
}

function normalizeLogLevel(level: string): LogEntry["level"] {
	const lower = level.toLowerCase();
	if (lower.includes("error") || lower.includes("fatal") || lower.includes("crit")) return "error";
	if (lower.includes("warn")) return "warn";
	if (lower.includes("debug") || lower.includes("trace")) return "debug";
	return "info";
}

function inferLogLevel(line: string): LogEntry["level"] {
	const lower = line.toLowerCase();
	if (lower.includes("error") || lower.includes("fatal") || lower.includes("exception") || lower.includes("panic")) return "error";
	if (lower.includes("warn")) return "warn";
	if (lower.includes("debug")) return "debug";
	return "info";
}
