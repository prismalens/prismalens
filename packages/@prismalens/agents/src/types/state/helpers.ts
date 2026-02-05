/**
 * State Helper Functions
 *
 * Utility functions for working with InvestigationState.
 */

import type { AlertContext, IncidentContext } from "../schemas/core.js";
import type { Hypothesis } from "../schemas/findings.js";
import type { InvestigationState } from "./annotation.js";

// =============================================================================
// STATE CREATION
// =============================================================================

/**
 * Create initial state from job data.
 * Requires incident context with optional alerts for supporting data.
 *
 * NOTE: Configuration fields (llmConfig, integrations, maxIterations, priority)
 * are now passed via InvestigationConfig in RunnableConfig.configurable,
 * NOT in state. This prevents credentials from being checkpointed.
 */
export function createInitialState(jobData: {
	investigationId: string;
	incidentId: string;
	incident?: IncidentContext;
	alerts?: AlertContext[];
}): Partial<InvestigationState> {
	return {
		investigationId: jobData.investigationId,
		incidentId: jobData.incidentId,
		incident: jobData.incident || null,
		alerts: jobData.alerts || [],
		primaryAlert: jobData.alerts?.[0] || null,
		status: "pending",
		// Supervisor Pattern initial state
		phase: "gathering",
		gatherIterations: 0,
		findings: [],
	};
}

// =============================================================================
// HYPOTHESIS HELPERS
// =============================================================================

/**
 * Extract the best hypothesis from state
 */
export function getBestHypothesis(
	state: InvestigationState,
): Hypothesis | null {
	if (state.hypotheses.length === 0) {
		return null;
	}
	return state.hypotheses.reduce(
		(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
		null as Hypothesis | null,
	);
}

/**
 * Check if investigation has sufficient confidence to proceed to fix proposal
 */
export function hasSufficientConfidence(
	state: InvestigationState,
	threshold: number = 80,
): boolean {
	const best = getBestHypothesis(state);
	return best !== null && best.confidence >= threshold;
}

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

/**
 * Get incident display info from state.
 * Returns incident context if available, otherwise builds context from primary alert.
 *
 * NOTE: Priority is now sourced from incident context or defaults to "normal"
 * since priority moved to InvestigationConfig (not in state).
 */
export function getIncidentDisplayInfo(state: InvestigationState): {
	incidentId: string;
	number?: number;
	title: string;
	description?: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	priority: string;
	serviceName?: string;
	alertCount: number;
} {
	// Prefer incident context if available
	if (state.incident) {
		return {
			incidentId: state.incident.incidentId,
			number: state.incident.number,
			title: state.incident.title,
			description: state.incident.description,
			severity: state.incident.severity,
			priority: state.incident.priority,
			serviceName: state.incident.serviceName,
			alertCount: state.incident.alertCount,
		};
	}

	// Fallback to alert-based context
	const primaryAlert = state.primaryAlert || state.alerts[0];
	return {
		incidentId: state.incidentId,
		title: primaryAlert?.title || "Unknown incident",
		description: primaryAlert?.description,
		severity: primaryAlert?.severity || "medium",
		priority: "normal", // Default - priority is now in config, not state
		serviceName: primaryAlert?.serviceName,
		alertCount: state.alerts.length,
	};
}
