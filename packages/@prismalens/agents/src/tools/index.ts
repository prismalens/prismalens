// =============================================================================
// TOOLS INDEX
// =============================================================================
// Central export for all tools. Use the factory pattern for integration-aware tools.
// =============================================================================

// Factory exports (preferred for new code)
export {
    createToolsForAgent,
    registerToolCategory,
    setAgentPermissions,
    getAgentPermissions,
    isReadOnlyAgent,
    setReadOnlyAgent,
    getToolCategories,
    type ToolFactoryOptions,
} from './factory.js';

export { createGitHubTools } from './github.js';
export { createRenderTools } from './render.js';
export { createRepoTools } from './repo.js';

// Hypothesis tools for Detective
export {
    createHypothesisTool,
    createEvaluateHypothesisTool,
    createDetectiveTools,
    resetHypothesisStore,
    getStoredHypotheses,
} from './hypothesis.js';

// Fix proposal tools for Surgeon
export {
    createProposeFixTool,
    createValidateCodeChangeTool,
    createSuggestRollbackTool,
    createSurgeonTools,
    resetRecommendationStore,
    getStoredRecommendations,
} from './fix-proposal.js';

// =============================================================================
// LEGACY EXPORTS (for backward compatibility)
// =============================================================================
// These static tool arrays don't support integrations. Use the factory functions
// with createToolsForAgent() for integration-aware tool creation.

import { createGitHubTools } from './github.js';
import { createRenderTools } from './render.js';
import { createRepoTools } from './repo.js';

/** @deprecated Use createGitHubTools() with integrations instead */
export const githubTools = createGitHubTools({
    agentName: 'default',
    integrations: [],
});

/** @deprecated Use createRenderTools() with integrations instead */
export const renderTools = createRenderTools({
    agentName: 'default',
    integrations: [],
});

/** @deprecated Use createRepoTools() with integrations instead */
export const repoTools = createRepoTools({
    agentName: 'default',
    integrations: [],
});
