/**
 * Agent factory exports.
 *
 * Each agent provides a factory function:
 * - supervisorNode: Function node returning Command
 * - createScoutNode(dataProvider): Simple function node
 * - createGathererNode(integrations, mcpTools): Function node wrapping createDeepAgent
 * - createAnalystGraph(): Compiled subgraph
 * - createResolverGraph(): Compiled subgraph
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
export { createAnalystGraph, buildAnalystGraph } from "./analyst/index.js"
export { AnalystStateAnnotation } from "./analyst/index.js"

// Resolver
export { createResolverGraph, buildResolverGraph } from "./resolver/index.js"
export { ResolverStateAnnotation } from "./resolver/index.js"
