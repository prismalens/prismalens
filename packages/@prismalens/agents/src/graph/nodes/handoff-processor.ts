/**
 * Handoff Processor Node
 *
 * Handles handoff state updates including validation, denial recording,
 * and completion tracking. This node is the central point for all
 * handoff lifecycle management.
 *
 * Called when:
 * 1. A handoff needs to be validated and potentially denied
 * 2. After a gatherer completes to mark handoff as complete
 *
 * @see HandoffManager in utils/handoff-manager.ts
 */

import { Logger } from "@prismalens/logger";
import {
	handoffManager,
	shouldStopGathering,
	type HandoffRecord,
	type GathererName,
} from "../../utils/handoff-manager.js";
import type {
	InvestigationState,
	SupervisorPhase,
} from "../../types/index.js";

const logger = new Logger({ context: "HandoffProcessor" });

// =============================================================================
// HANDOFF PROCESSOR NODE
// =============================================================================

/**
 * Process handoff request - validate, record, and determine next step.
 *
 * This node is called when a handoff needs validation. It:
 * 1. Checks if gathering should stop (progress-based termination)
 * 2. Creates a handoff record
 * 3. Validates the handoff against capabilities
 * 4. Either denies (with feedback) or allows (dispatch happens in supervisor)
 */
export async function handoffProcessorNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	const { handoffRequest, clonePaths, handoffHistory = [], hypotheses = [] } = state;

	if (!handoffRequest) {
		logger.warn("HandoffProcessor called without handoff request");
		return {};
	}

	logger.info("Processing handoff request", {
		from: "detective",
		to: handoffRequest.to,
		reason: handoffRequest.reason,
	});

	// Create handoff record first
	let handoff = handoffManager.createHandoff(
		"detective",
		handoffRequest.to as GathererName,
		handoffRequest.reason,
		{ query: handoffRequest.context },
	);

	// FIRST: Check if we should stop gathering (progress-based termination)
	// This takes precedence over capability validation
	const stopDecision = shouldStopGathering(handoffHistory, hypotheses);
	if (stopDecision.stop) {
		// Deny the handoff with termination reason
		handoff = handoffManager.markDenied(handoff, stopDecision.reason);

		logger.info("Handoff denied due to termination condition", {
			target: handoffRequest.to,
			reason: stopDecision.reason,
			hypothesesCount: hypotheses.length,
		});

		// If we have hypotheses, go straight to analyzing
		// If we DON'T have hypotheses, give detective one final chance to form them
		if (hypotheses.length > 0) {
			return {
				handoffRequest: undefined, // Clear request
				handoffHistory: [handoff], // Append denied record to history
				phase: "analyzing" as SupervisorPhase,
			};
		}

		// No hypotheses yet - give detective one final chance with finalAnalysisOnly flag
		// This forces detective to form hypotheses without requesting more data
		logger.info("No hypotheses formed, triggering final analysis mode");
		return {
			handoffRequest: undefined, // Clear request
			handoffHistory: [handoff], // Append denied record to history
			finalAnalysisOnly: true, // Force detective to form hypotheses
			// Stay in targeted_gather phase so routing goes back to detective
			phase: "targeted_gather" as SupervisorPhase,
		};
	}

	// Build capability map
	const capabilities = {
		clonePaths: !!clonePaths && Object.keys(clonePaths).length > 0,
	};

	// Validate capabilities
	const validation = handoffManager.validateHandoff(
		"detective",
		handoffRequest.to as GathererName,
		capabilities,
	);

	if (!validation.allowed) {
		// Mark denied and add to history
		handoff = handoffManager.markDenied(handoff, validation.denialReason!);

		logger.info("Handoff denied due to missing capability", {
			target: handoffRequest.to,
			reason: validation.denialReason,
		});

		return {
			handoffRequest: undefined, // Clear request
			handoffHistory: [handoff], // Append to history
			// Stay in analyzing phase - detective will re-run with denial feedback
			phase: "analyzing" as SupervisorPhase,
		};
	}

	// Valid handoff - mark as dispatched and add to history
	handoff = handoffManager.markDispatched(handoff);

	logger.info("Handoff validated and dispatched", {
		target: handoffRequest.to,
		handoffId: handoff.id,
	});

	return {
		handoffHistory: [handoff], // Append dispatched record to history
		// Keep handoffRequest - supervisor will use it to route to gatherer
		// Phase transition happens in detective node
	};
}

// =============================================================================
// ROUTING FUNCTION
// =============================================================================

/**
 * Route after handoff processing.
 *
 * If handoff was denied:
 *   - If phase is "analyzing" → to supervisor (which routes to surgeon or complete)
 *   - Otherwise → back to detective (with denial in history)
 * If handoff was dispatched → to supervisor (which routes to gatherer)
 */
export function handoffProcessorRoute(state: InvestigationState): string {
	// If handoffRequest is cleared, the handoff was denied
	if (!state.handoffRequest) {
		// If phase is "analyzing", it means we stopped due to termination (e.g., high confidence)
		// Route to supervisor which will handle the analyzing phase and go to surgeon/complete
		if (state.phase === "analyzing") {
			logger.debug("Handoff denied with analyzing phase, routing to supervisor");
			return "supervisor";
		}

		// Otherwise, route back to detective with denial feedback
		logger.debug("Handoff was denied, routing back to detective");
		return "detective";
	}

	// Handoff is valid, let supervisor dispatch to gatherer
	logger.debug("Handoff validated, routing to supervisor for dispatch");
	return "supervisor";
}

// =============================================================================
// HELPER FUNCTIONS FOR GATHERERS
// =============================================================================

/**
 * Mark the most recent dispatched handoff as completed.
 * Called by gatherers after they complete their work.
 *
 * @param state Current investigation state
 * @param resultSummary Summary of what was found
 * @param findingsAdded Number of new findings added
 * @returns Partial state update with completed handoff
 */
export function createHandoffCompletionUpdate(
	state: InvestigationState,
	resultSummary: string,
	findingsAdded: number,
): Partial<InvestigationState> {
	const history = state.handoffHistory || [];

	// Find the most recent dispatched handoff (not completed yet)
	const pendingIndex = history.findIndex((h) => h.status === "dispatched");

	if (pendingIndex === -1) {
		// No pending handoff - this was an initial gather, not a targeted one
		return {
			handoffRequest: undefined,
		};
	}

	const pending = history[pendingIndex];
	const completed = handoffManager.markCompleted(
		pending,
		resultSummary,
		findingsAdded,
	);

	// Create updated history with completed record
	// We need to return only the completed record as the reducer will append it
	// But we also need to "replace" the dispatched one
	// Since the reducer appends, we'll handle this differently in state

	logger.info("Marking handoff as completed", {
		handoffId: pending.id,
		target: pending.to,
		findingsAdded,
	});

	// Note: We return the completed handoff to append to history
	// The old dispatched record remains but the latest status is what matters
	// A more sophisticated approach would update in place, but append-only is simpler
	return {
		handoffRequest: undefined, // Clear the request
		handoffHistory: [completed], // Append completion record
	};
}

/**
 * Build capabilities map from investigation state.
 * Used by supervisor and handoff processor.
 */
export function buildCapabilities(
	state: InvestigationState,
): Record<string, boolean> {
	return {
		clonePaths: !!state.clonePaths && Object.keys(state.clonePaths).length > 0,
		// Add more capabilities as needed:
		// observabilityIntegration: hasObservabilityIntegration(state.integrations),
		// etc.
	};
}
