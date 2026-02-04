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
	type InvestigationCallbacks,
	InvestigationExecutor,
	type InvestigationExecutorOptions,
	type InvestigationInput,
	type InvestigationResult,
} from "./executor.js";
