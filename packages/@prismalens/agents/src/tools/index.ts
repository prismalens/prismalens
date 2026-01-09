// =============================================================================
// TOOLS INDEX
// =============================================================================
// Central export for all tools. Use the factory pattern for integration-aware tools.
// =============================================================================

// Factory exports (preferred for new code)
export {
	createToolsForAgent,
	getAgentPermissions,
	getToolCategories,
	isReadOnlyAgent,
	registerToolCategory,
	setAgentPermissions,
	setReadOnlyAgent,
	type ToolFactoryOptions,
} from "./factory.js";
// Fix proposal tools for Surgeon
export {
	createProposeFixTool,
	createSuggestRollbackTool,
	createSurgeonTools,
	createValidateCodeChangeTool,
	getStoredRecommendations,
	resetRecommendationStore,
} from "./fix-proposal.js";
export { createGitHubTools } from "./github.js";
// Hypothesis tools for Detective
export {
	createDetectiveTools,
	createEvaluateHypothesisTool,
	createHypothesisTool,
	getStoredHypotheses,
	resetHypothesisStore,
} from "./hypothesis.js";
export { createRenderTools } from "./render.js";
export { createRepoTools } from "./repo.js";

// =============================================================================
// LEGACY EXPORTS (for backward compatibility)
// =============================================================================
// These static tool arrays don't support integrations. Use the factory functions
// with createToolsForAgent() for integration-aware tool creation.

import { createGitHubTools } from "./github.js";
import { createRenderTools } from "./render.js";
import { createRepoTools } from "./repo.js";

/** @deprecated Use createGitHubTools() with integrations instead */
export const githubTools = createGitHubTools({
	agentName: "default",
	integrations: [],
});

/** @deprecated Use createRenderTools() with integrations instead */
export const renderTools = createRenderTools({
	agentName: "default",
	integrations: [],
});

/** @deprecated Use createRepoTools() with integrations instead */
export const repoTools = createRepoTools({
	agentName: "default",
	integrations: [],
});
