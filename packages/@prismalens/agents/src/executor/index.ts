// =============================================================================
// EXECUTOR INDEX
// =============================================================================
// Export execution tracking and executor utilities.
// =============================================================================

export {
	createExecutionTracker,
	createExecutionTrackerCallback,
	ExecutionTracker,
	ExecutionTrackerCallbackHandler,
	type ExecutionTrackerOptions,
} from "./callbacks.js";

export {
	executeInvestigation,
	getDefaultExecutor,
	type InvestigationCallbacks,
	InvestigationExecutor,
	type InvestigationInput,
	type InvestigationResult,
} from "./executor.js";
