/**
 * Unified Handoff Framework
 *
 * Implements industry best practices for agent-to-agent handoffs:
 * - Handoff as Versioned API: Every handoff has schema, validation, status, and trace_id
 * - Task vs Action Separation: Handoff = Task (what), Tool execution = Action (how)
 * - Shared Context History: Handoff history accessible to all agents
 * - Explicit Handoff Graph: Predefined allowed transitions between agents
 * - Response Callbacks: Completion/denial feedback flows back to requester
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
 * @see https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/handoff
 */

import { Logger } from "@prismalens/logger";

const logger = new Logger({ context: "HandoffManager" });

// =============================================================================
// TYPES
// =============================================================================

export type HandoffStatus =
	| "pending"
	| "dispatched"
	| "denied"
	| "completed"
	| "failed";

/**
 * All agents that can participate in handoffs.
 * Includes supervisor and gatherer-coordinator for orchestration.
 */
export type HandoffAgentName =
	| "detective"
	| "log-gatherer"
	| "code-searcher"
	| "change-tracker"
	| "surgeon"
	| "adversary"
	| "supervisor"
	| "gatherer-coordinator";

export type GathererName = "log-gatherer" | "code-searcher" | "change-tracker";

/**
 * Capabilities required by each agent.
 * Used for validation during handoff requests.
 */
export const HANDOFF_CAPABILITIES: Record<
	HandoffAgentName,
	{
		/** State fields that must be present */
		requires?: string[];
		/** Conditions that block this agent */
		blockedBy?: string[];
	}
> = {
	"log-gatherer": {
		requires: [], // Always available (can use local files as fallback)
	},
	"code-searcher": {
		requires: ["clonePaths"], // Requires cloned repositories
	},
	"change-tracker": {
		requires: [], // Can use pre-gathered data
	},
	detective: {
		requires: [], // Always available
	},
	adversary: {
		requires: ["hypotheses"], // Requires hypothesis to challenge
	},
	surgeon: {
		requires: ["hypotheses"], // Requires hypothesis to fix
		blockedBy: ["lowConfidence"], // Blocked if confidence < 70%
	},
	supervisor: {
		requires: [], // Always available
	},
	"gatherer-coordinator": {
		requires: [], // Always available
	},
};

/**
 * Record of a handoff request and its lifecycle.
 * Tracks from request through dispatch/denial to completion.
 */
export interface HandoffRecord {
	/** Unique identifier for this handoff */
	id: string;
	/** OpenTelemetry trace ID for correlation (optional) */
	traceId?: string;
	/** Agent that initiated the handoff */
	from: HandoffAgentName;
	/** Target agent for the handoff */
	to: HandoffAgentName;
	/** Why this handoff was requested */
	reason: string;
	/** Additional context for the target agent */
	context?: Record<string, unknown>;
	/** Current status of the handoff */
	status: HandoffStatus;
	/** If denied, why it was denied */
	denialReason?: string;
	/** When the handoff was requested */
	requestedAt: string;
	/** When the handoff was dispatched to target */
	dispatchedAt?: string;
	/** When the handoff completed (success, denial, or failure) */
	completedAt?: string;
	/** Summary of results if completed successfully */
	resultSummary?: string;
	/** Number of findings added by this handoff */
	findingsAdded?: number;
}

/**
 * Defines an allowed handoff route between agents.
 */
export interface HandoffRoute {
	/** Source agent */
	from: HandoffAgentName;
	/** Target agent */
	to: HandoffAgentName;
	/** Human-readable description of this route */
	description?: string;
	/** Capability required for this route (e.g., "clonePaths" for code-searcher) */
	requiresCapability?: string;
}

// =============================================================================
// HANDOFF REGISTRY
// =============================================================================

/**
 * Defines allowed handoff routes between agents.
 * Full mesh topology with capability-based validation.
 *
 * Routes are organized by source agent:
 * - Supervisor can route to any agent
 * - Detective can request data and challenge validation
 * - Gatherers can report back to coordinator or request detective analysis
 * - Adversary can request refinement from detective
 * - Surgeon can request more analysis if needed
 */
export const HANDOFF_ROUTES: HandoffRoute[] = [
	// ==========================================================================
	// SUPERVISOR ROUTES (orchestration)
	// ==========================================================================
	{
		from: "supervisor",
		to: "gatherer-coordinator",
		description: "Initiate data gathering phase",
	},
	{
		from: "supervisor",
		to: "detective",
		description: "Initiate analysis phase",
	},
	{
		from: "supervisor",
		to: "adversary",
		description: "Request hypothesis challenge or scope check",
	},
	{
		from: "supervisor",
		to: "surgeon",
		description: "Initiate fix proposal phase",
	},

	// ==========================================================================
	// GATHERER COORDINATOR ROUTES (data gathering orchestration)
	// ==========================================================================
	{
		from: "gatherer-coordinator",
		to: "log-gatherer",
		description: "Request log gathering",
	},
	{
		from: "gatherer-coordinator",
		to: "code-searcher",
		description: "Request code search",
		requiresCapability: "clonePaths",
	},
	{
		from: "gatherer-coordinator",
		to: "change-tracker",
		description: "Request change tracking",
	},
	{
		from: "gatherer-coordinator",
		to: "supervisor",
		description: "Report gathering complete",
	},

	// ==========================================================================
	// DETECTIVE ROUTES (analysis)
	// ==========================================================================
	{
		from: "detective",
		to: "log-gatherer",
		description: "Request additional logs",
	},
	{
		from: "detective",
		to: "code-searcher",
		description: "Search codebase for patterns",
		requiresCapability: "clonePaths",
	},
	{
		from: "detective",
		to: "change-tracker",
		description: "Get deployment/commit history",
	},
	{
		from: "detective",
		to: "adversary",
		description: "Request hypothesis challenge",
	},
	{
		from: "detective",
		to: "supervisor",
		description: "Report analysis complete",
	},
	{
		from: "detective",
		to: "gatherer-coordinator",
		description: "Request multi-source gathering",
	},

	// ==========================================================================
	// GATHERER ROUTES (data collection)
	// ==========================================================================
	{
		from: "log-gatherer",
		to: "gatherer-coordinator",
		description: "Report log gathering complete",
	},
	{
		from: "log-gatherer",
		to: "detective",
		description: "Request analysis of log findings",
	},
	{
		from: "code-searcher",
		to: "gatherer-coordinator",
		description: "Report code search complete",
	},
	{
		from: "code-searcher",
		to: "detective",
		description: "Request analysis of code findings",
	},
	{
		from: "change-tracker",
		to: "gatherer-coordinator",
		description: "Report change tracking complete",
	},
	{
		from: "change-tracker",
		to: "detective",
		description: "Request analysis of change findings",
	},

	// ==========================================================================
	// ADVERSARY ROUTES (oversight)
	// ==========================================================================
	{
		from: "adversary",
		to: "detective",
		description: "Request hypothesis refinement",
	},
	{
		from: "adversary",
		to: "supervisor",
		description: "Report challenge complete or scope issue",
	},
	{
		from: "adversary",
		to: "gatherer-coordinator",
		description: "Request additional data for validation",
	},

	// ==========================================================================
	// SURGEON ROUTES (fix proposal)
	// ==========================================================================
	{
		from: "surgeon",
		to: "detective",
		description: "Request more analysis for fix",
	},
	{
		from: "surgeon",
		to: "code-searcher",
		description: "Request code context for fix",
		requiresCapability: "clonePaths",
	},
	{
		from: "surgeon",
		to: "supervisor",
		description: "Report fix proposal complete",
	},
];

// =============================================================================
// HANDOFF MANAGER
// =============================================================================

/**
 * Central manager for agent handoffs.
 * Provides validation, tracking, and feedback for all handoff operations.
 */
export class HandoffManager {
	private routes: HandoffRoute[];

	constructor(routes: HandoffRoute[] = HANDOFF_ROUTES) {
		this.routes = routes;
	}

	/**
	 * Check if a handoff route is allowed and available.
	 *
	 * @param from Source agent
	 * @param to Target agent
	 * @param capabilities Current capability state (e.g., { clonePaths: true })
	 * @returns Validation result with allowed status and optional denial reason
	 */
	validateHandoff(
		from: HandoffAgentName,
		to: HandoffAgentName,
		capabilities: Record<string, boolean> = {},
	): { allowed: boolean; denialReason?: string } {
		// Check if route exists
		const route = this.routes.find((r) => r.from === from && r.to === to);
		if (!route) {
			return {
				allowed: false,
				denialReason: `No handoff route defined from ${from} to ${to}`,
			};
		}

		// Check if required capability is available
		if (route.requiresCapability) {
			const hasCapability = capabilities[route.requiresCapability] ?? false;
			if (!hasCapability) {
				return {
					allowed: false,
					denialReason: `${to} requires ${route.requiresCapability} which is not available`,
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Create a new handoff record.
	 */
	createHandoff(
		from: HandoffAgentName,
		to: HandoffAgentName,
		reason: string,
		context?: Record<string, unknown>,
	): HandoffRecord {
		return {
			id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			from,
			to,
			reason,
			context,
			status: "pending",
			requestedAt: new Date().toISOString(),
		};
	}

	/**
	 * Mark handoff as dispatched to target agent.
	 */
	markDispatched(handoff: HandoffRecord): HandoffRecord {
		logger.debug("Handoff dispatched", {
			id: handoff.id,
			from: handoff.from,
			to: handoff.to,
		});
		return {
			...handoff,
			status: "dispatched",
			dispatchedAt: new Date().toISOString(),
		};
	}

	/**
	 * Mark handoff as denied with reason.
	 */
	markDenied(handoff: HandoffRecord, denialReason: string): HandoffRecord {
		logger.warn("Handoff denied", {
			id: handoff.id,
			from: handoff.from,
			to: handoff.to,
			denialReason,
		});
		return {
			...handoff,
			status: "denied",
			denialReason,
			completedAt: new Date().toISOString(),
		};
	}

	/**
	 * Mark handoff as completed with results.
	 */
	markCompleted(
		handoff: HandoffRecord,
		resultSummary: string,
		findingsAdded: number = 0,
	): HandoffRecord {
		logger.info("Handoff completed", {
			id: handoff.id,
			from: handoff.from,
			to: handoff.to,
			findingsAdded,
		});
		return {
			...handoff,
			status: "completed",
			completedAt: new Date().toISOString(),
			resultSummary,
			findingsAdded,
		};
	}

	/**
	 * Mark handoff as failed.
	 */
	markFailed(handoff: HandoffRecord, error: string): HandoffRecord {
		logger.error("Handoff failed", {
			id: handoff.id,
			from: handoff.from,
			to: handoff.to,
			error,
		});
		return {
			...handoff,
			status: "failed",
			completedAt: new Date().toISOString(),
			resultSummary: `Failed: ${error}`,
		};
	}

	/**
	 * Get available handoff targets for an agent.
	 * Only returns targets where required capabilities are met.
	 */
	getAvailableTargets(
		from: HandoffAgentName,
		capabilities: Record<string, boolean> = {},
	): Array<{ to: HandoffAgentName; description?: string }> {
		return this.routes
			.filter((route) => route.from === from)
			.filter((route) => {
				if (!route.requiresCapability) return true;
				return capabilities[route.requiresCapability] ?? false;
			})
			.map((route) => ({ to: route.to, description: route.description }));
	}

	/**
	 * Get unavailable handoff targets with reasons.
	 * Returns targets that are defined but currently unavailable.
	 */
	getUnavailableTargets(
		from: HandoffAgentName,
		capabilities: Record<string, boolean> = {},
	): Array<{ to: HandoffAgentName; reason: string }> {
		return this.routes
			.filter((route) => route.from === from)
			.filter((route) => {
				if (!route.requiresCapability) return false;
				return !(capabilities[route.requiresCapability] ?? false);
			})
			.map((route) => ({
				to: route.to,
				reason: `Requires ${route.requiresCapability}`,
			}));
	}

	/**
	 * Get all routes for a given source agent.
	 */
	getRoutes(from: HandoffAgentName): HandoffRoute[] {
		return this.routes.filter((route) => route.from === from);
	}
}

// =============================================================================
// TERMINATION LOGIC
// =============================================================================

/** Confidence threshold for proceeding to fix phase */
const FIX_CONFIDENCE_THRESHOLD = 70;

/** Maximum handoff attempts before forced termination */
const MAX_HANDOFFS = 5;

/**
 * Determine if gathering should stop based on progress indicators.
 * Replaces crude iteration limits with intelligent termination.
 *
 * @param handoffHistory History of all handoff attempts
 * @param hypotheses Current hypotheses from detective
 * @returns Decision with stop flag and reason
 */
export function shouldStopGathering(
	handoffHistory: HandoffRecord[],
	hypotheses: Array<{ confidence: number }>,
): { stop: boolean; reason: string } {
	// 1. High confidence hypothesis → stop, proceed to fix
	const bestConfidence = Math.max(...hypotheses.map((h) => h.confidence), 0);
	if (bestConfidence >= FIX_CONFIDENCE_THRESHOLD) {
		return {
			stop: true,
			reason: `High confidence hypothesis (${bestConfidence}%) formed`,
		};
	}

	// 2. All requests denied → stop, can't get more data
	const uniqueDenied = new Set(
		handoffHistory.filter((h) => h.status === "denied").map((h) => h.to),
	);
	// If all 3 gatherers have been denied at least once
	const allGatherersDenied = uniqueDenied.size >= 3;
	if (allGatherersDenied) {
		return {
			stop: true,
			reason: "All available data sources exhausted",
		};
	}

	// 3. Last two completed handoffs produced no new findings → diminishing returns
	const completions = handoffHistory.filter((h) => h.status === "completed");
	if (completions.length >= 2) {
		const lastTwo = completions.slice(-2);
		const noProgress = lastTwo.every((h) => (h.findingsAdded || 0) === 0);
		if (noProgress) {
			return {
				stop: true,
				reason: "No new findings from last two data requests",
			};
		}
	}

	// 4. Safety limit (fallback, but with clear feedback)
	if (handoffHistory.length >= MAX_HANDOFFS) {
		return {
			stop: true,
			reason: `Maximum handoff attempts (${MAX_HANDOFFS}) reached`,
		};
	}

	return { stop: false, reason: "" };
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default HandoffManager instance.
 * Use this for standard handoff operations.
 */
export const handoffManager = new HandoffManager();
