/**
 * Agent factory exports.
 *
 * Each agent provides a factory function:
 * - supervisorNode: Function node returning Command
 * - createScoutNode(dataProvider): Simple function node
 * - createGathererNode(integrations, mcpTools): Function node wrapping createDeepAgent
 * - createAnalystNode(integrations, mcpTools): Function node wrapping createDeepAgent
 * - createResolverNode(integrations, mcpTools): Function node wrapping createDeepAgent
 */

// Supervisor
export { supervisorNode } from "./supervisor/index.js"
export {
  compilePartialResult,
  takeProgressSnapshot,
  detectProgress,
} from "./supervisor/index.js"

// Scout
export { createScoutNode } from "./scout/index.js"

// Gatherer
export { createGathererNode } from "./gatherer/index.js"
export { GathererStateAnnotation } from "./gatherer/index.js"

// Analyst
export { createAnalystNode } from "./analyst/index.js"
export { scoreHypothesis, extractAnalystResults } from "./analyst/index.js"

// Resolver
export { createResolverNode } from "./resolver/index.js"
export { extractResolverResults } from "./resolver/index.js"
