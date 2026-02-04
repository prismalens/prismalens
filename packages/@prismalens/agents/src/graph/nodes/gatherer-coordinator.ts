/**
 * GathererCoordinator Node
 *
 * Sub-supervisor for data gathering agents. Receives gathering requests from
 * supervisor or detective and routes to appropriate gatherer(s).
 *
 * Responsibilities:
 * - Receive gathering requests from supervisor or detective
 * - Route to appropriate gatherer(s) based on capabilities
 * - Handle sequential ordering (code-searcher → change-tracker)
 * - Track gatherer executions via findings presence
 *
 * NO peer communication between gatherers - coordinator orchestrates.
 */

import { Logger } from "@prismalens/logger";
import type {
	Finding,
	InvestigationState,
} from "../../types/state.js";
import { hasClonedRepos } from "./supervisor.js";

const logger = new Logger({ context: "GathererCoordinator" });

// =============================================================================
// TYPES
// =============================================================================

/** Gatherer agent names that the coordinator manages */
export type GathererAgentName = "log-gatherer" | "code-searcher" | "change-tracker";

/** Gatherer capability requirements */
interface GathererCapability {
	name: GathererAgentName;
	requires: (state: InvestigationState) => boolean;
	priority: number; // Lower = runs first
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Gatherer capabilities with requirements and execution order.
 * Ordered by data dependency:
 * 1. code-searcher: Uses preGathered log data for error patterns
 * 2. change-tracker: Uses code findings for file correlation
 * 3. log-gatherer: On-demand, targeted by detective
 */
const GATHERER_CAPABILITIES: GathererCapability[] = [
	{
		name: "code-searcher",
		requires: (state) => hasClonedRepos(state.clonePaths),
		priority: 1,
	},
	{
		name: "change-tracker",
		requires: () => true, // Always available (uses GitHub API)
		priority: 2,
	},
	{
		name: "log-gatherer",
		requires: () => true, // Always available for targeted requests
		priority: 3,
	},
];

// =============================================================================
// COMPLETION HELPERS
// =============================================================================

/**
 * Check if a gatherer has produced findings.
 * Gatherer is considered complete when it has at least one finding.
 */
function hasGathererFindings(findings: Finding[], gathererName: GathererAgentName): boolean {
	return findings.some((f) => f.source === gathererName);
}

/**
 * Check if a gatherer is complete (has findings or is unavailable).
 */
function isGathererComplete(state: InvestigationState, gathererName: GathererAgentName): boolean {
	// Check if gatherer has produced findings
	if (hasGathererFindings(state.findings, gathererName)) {
		return true;
	}

	// Check if gatherer is marked as unavailable
	if (state.unavailableGatherers?.includes(gathererName)) {
		return true;
	}

	return false;
}

// =============================================================================
// COORDINATOR NODE
// =============================================================================

/**
 * GathererCoordinator node - sub-supervisor for data gathering.
 *
 * This node:
 * 1. Determines which gatherers are available based on state
 * 2. Sets up the gathering sequence
 * 3. Returns the next gatherer to dispatch
 *
 * The actual routing is handled by gathererCoordinatorRoute.
 */
export async function gathererCoordinatorNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	const availableGatherers = getAvailableGatherers(state);
	const pendingGatherers = getPendingGatherers(state, availableGatherers);

	logger.info("GathererCoordinator assessing", {
		investigationId: state.investigationId,
		availableGatherers: availableGatherers.map((g) => g.name),
		pendingGatherers: pendingGatherers.map((g) => g.name),
		phase: state.phase,
		hasHandoffRequest: !!state.handoffRequest,
	});

	// If this is a targeted gather (from detective), handle differently
	if (state.handoffRequest) {
		const target = state.handoffRequest.to as GathererAgentName;
		const isGatherer = GATHERER_CAPABILITIES.some((g) => g.name === target);

		if (isGatherer) {
			logger.info("Targeted gather request received", {
				target,
				reason: state.handoffRequest.reason,
			});
			// Let the routing function handle dispatch
			return {};
		}
	}

	// For initial gathering phase, set up the sequence
	if (state.phase === "gathering") {
		logger.info("Setting up initial gathering sequence", {
			sequence: pendingGatherers.map((g) => g.name),
		});
	}

	// The actual routing happens in gathererCoordinatorRoute
	return {};
}

// =============================================================================
// ROUTING FUNCTION
// =============================================================================

/**
 * Routing function for GathererCoordinator.
 * Determines which gatherer to dispatch next.
 */
export function gathererCoordinatorRoute(
	state: InvestigationState,
): string {
	const availableGatherers = getAvailableGatherers(state);
	const pendingGatherers = getPendingGatherers(state, availableGatherers);

	// Handle targeted gather requests from detective
	if (state.handoffRequest) {
		const target = state.handoffRequest.to as GathererAgentName;
		const gatherer = GATHERER_CAPABILITIES.find((g) => g.name === target);

		if (gatherer) {
			// Check if gatherer is available
			if (gatherer.requires(state)) {
				logger.info("Routing to targeted gatherer", { target });
				return target;
			}
			// Gatherer not available - return to supervisor (which routes to processHandoff)
			logger.info("Targeted gatherer not available", {
				target,
				reason: "capability requirements not met",
			});
			return "supervisor";
		}
	}

	// For initial/sequential gathering, dispatch next pending gatherer
	if (pendingGatherers.length > 0) {
		const nextGatherer = pendingGatherers[0];
		logger.info("Routing to next gatherer in sequence", {
			gatherer: nextGatherer.name,
			remaining: pendingGatherers.length - 1,
		});
		return nextGatherer.name;
	}

	// All gatherers complete - return to supervisor for quality gate
	logger.info("All gatherers complete, returning to supervisor");
	return "supervisor";
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get list of gatherers that are available based on state capabilities.
 */
function getAvailableGatherers(state: InvestigationState): GathererCapability[] {
	return GATHERER_CAPABILITIES.filter((g) => g.requires(state));
}

/**
 * Get list of gatherers that haven't completed yet, sorted by priority.
 * Uses findings presence to determine completion.
 */
function getPendingGatherers(
	state: InvestigationState,
	availableGatherers: GathererCapability[],
): GathererCapability[] {
	return availableGatherers
		.filter((g) => !isGathererComplete(state, g.name))
		.sort((a, b) => a.priority - b.priority);
}

/**
 * Check if all initial gathering is complete.
 */
export function isInitialGatheringComplete(state: InvestigationState): boolean {
	const availableGatherers = getAvailableGatherers(state);
	const pendingGatherers = getPendingGatherers(state, availableGatherers);
	return pendingGatherers.length === 0;
}

/**
 * Get the next gatherer in sequence, if any.
 */
export function getNextGatherer(
	state: InvestigationState,
): GathererAgentName | null {
	const availableGatherers = getAvailableGatherers(state);
	const pendingGatherers = getPendingGatherers(state, availableGatherers);

	if (pendingGatherers.length === 0) {
		return null;
	}

	return pendingGatherers[0].name;
}
