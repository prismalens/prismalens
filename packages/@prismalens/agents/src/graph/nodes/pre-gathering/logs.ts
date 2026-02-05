/**
 * Log preview fetching for pre-gathering phase
 */

import { Logger } from "@prismalens/logger";
import type { LogEntry, LogPreviewContext } from "../../../types/index.js";
import type { GatheringContext, GatherResult } from "./types.js";

const logger = new Logger({ context: "PreGather:Logs" });

/**
 * Check if logging integration is available
 */
export function hasLoggingIntegration(ctx: GatheringContext): boolean {
	// Integrations are now passed via context from RunnableConfig, not from state
	return ctx.integrations.some(
		(i) =>
			i.type === "logging" ||
			i.type === "loki" ||
			i.type === "elasticsearch" ||
			i.type === "datadog",
	);
}

/**
 * Preview recent error logs for the incident context
 * Returns null if no logging integration is available
 */
export async function previewLogs(
	ctx: GatheringContext,
): Promise<GatherResult<LogPreviewContext | null>> {
	const startTime = Date.now();

	try {
		const { state, incidentTime } = ctx;

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

		// TODO: Query actual log aggregation system when MCP integration is available
		// For now, return empty preview - this will be populated when:
		// 1. Loki/Elasticsearch/Datadog MCP server is connected
		// 2. Log retrieval tools are available in integrations
		const errorLogs: LogEntry[] = [];

		logger.debug("Log preview complete", {
			errorLogCount: errorLogs.length,
		});

		return {
			success: true,
			data: {
				errorLogs,
				timeRange: {
					start: timeRangeStart,
					end: timeRangeEnd,
				},
				source: undefined, // Will be set when integration is available
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
