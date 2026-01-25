// =============================================================================
// TOOLS INDEX
// =============================================================================
// Central export for all tools. Use the factory pattern for integration-aware tools.
// Progressive disclosure system available via bundles exports.
// =============================================================================

// Factory exports (preferred for new code)
export {
	contextToFactoryOptions,
	createDefaultBundleRegistry,
	createProgressiveTools,
	createToolsForAgent,
	factoryOptionsToContext,
	getAgentPermissions,
	getManifestsDir,
	getToolCategories,
	isReadOnlyAgent,
	registerToolCategory,
	setAgentPermissions,
	setReadOnlyAgent,
	type ProgressiveToolsOptions,
	type ToolFactoryOptions,
} from "./factory.js";

// Bundle system exports
export * from "./bundles/index.js";
// Fix proposal tools for Surgeon
export {
	createProposeFixTool,
	createSuggestRollbackTool,
	createSurgeonTools,
	createValidateCodeChangeTool,
	getStoredRecommendations,
	resetRecommendationStore,
} from "./fix-proposal.js";
// Hypothesis tools for Detective
export {
	createDetectiveTools,
	createEvaluateHypothesisTool,
	createHypothesisTool,
	getStoredHypotheses,
	resetHypothesisStore,
} from "./hypothesis.js";
// Challenge tools for Adversary
export {
	createAdversaryTools,
	createChallengeHypothesisTool,
	createPatternMatchTool,
	createRefineHypothesisTool,
	getStoredChallenges,
	resetChallengeStore,
	// Note: AdversaryChallenge type is exported from types/index.ts
} from "./challenge.js";
export { createRepoTools } from "./repo.js";
