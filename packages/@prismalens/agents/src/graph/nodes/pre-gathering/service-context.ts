/**
 * Service context fetching for pre-gathering phase
 */

import { Logger } from "@prismalens/logger";
import type {
	ServiceContext,
	ServiceHealthStatus,
	ServiceInfo,
} from "../../../types/state.js";
import type { GatheringContext, GatherResult } from "./types.js";

const logger = new Logger({ context: "PreGather:ServiceContext" });

/**
 * Fetch service context including info and dependencies
 * Currently builds context from available state - will be enhanced when service topology is available
 */
export async function fetchServiceContext(
	ctx: GatheringContext,
): Promise<GatherResult<ServiceContext>> {
	const startTime = Date.now();

	try {
		const { state, serviceId } = ctx;
		const incident = state.incident;

		logger.debug("Fetching service context", {
			serviceId,
			hasIncident: !!incident,
		});

		// Build service info from incident context
		let service: ServiceInfo | null = null;
		if (incident?.serviceId || incident?.serviceName) {
			service = {
				id: incident.serviceId || "unknown",
				name: incident.serviceName || "Unknown Service",
				displayName: incident.serviceName,
				// These would come from actual service lookup in the future
				type: undefined,
				tier: undefined,
				team: undefined,
				repository: state.primaryAlert?.repository,
			};
		}

		// TODO: Query ServiceDependency table when service topology is implemented
		// For now, return empty arrays
		const dependencies: string[] = [];
		const dependents: string[] = [];

		// TODO: Query health status from monitoring integrations
		const healthStatus: ServiceHealthStatus[] = [];

		logger.debug("Fetched service context", {
			hasService: !!service,
			dependencies: dependencies.length,
			dependents: dependents.length,
		});

		return {
			success: true,
			data: {
				service,
				dependencies,
				dependents,
				healthStatus,
			},
			durationMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error("Failed to fetch service context", { error: errorMessage });
		return {
			success: false,
			data: null,
			error: errorMessage,
			durationMs: Date.now() - startTime,
		};
	}
}
