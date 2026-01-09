// =============================================================================
// EXECUTOR INDEX
// =============================================================================
// Export execution tracking and executor utilities.
// =============================================================================

export {
    ExecutionTracker,
    ExecutionTrackerCallbackHandler,
    createExecutionTracker,
    createExecutionTrackerCallback,
    type ExecutionTrackerOptions,
} from './callbacks.js';

export {
    InvestigationExecutor,
    getDefaultExecutor,
    executeInvestigation,
    type InvestigationInput,
    type InvestigationResult,
    type InvestigationCallbacks,
} from './executor.js';
