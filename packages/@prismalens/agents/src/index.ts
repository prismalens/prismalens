// =============================================================================
// @prismalens/agents
// =============================================================================
// PrismaLens Agent System - Hybrid DeepAgents + LangGraph for Incident Investigation
//
// This package provides the core agent infrastructure for investigating production
// incidents. It can be used:
// - Directly by packages/api in regular mode (no separate worker process)
// - As a dependency by packages/worker in queue mode (separate container)
//
// Architecture:
// - DeepAgents provides Commander with write_todos planning and task SubAgent delegation
// - LangGraph provides PostgresSaver persistence, alert validation, and API writer nodes
// - Per-agent LLM configuration via environment variables
// - Tool factory pattern for plug-and-play integrations
// =============================================================================

// Types
export * from './types/index.js';

// LLM Factory
export * from './llm/index.js';

// Tools
export * from './tools/index.js';

// Agents
export * from './agents/index.js';

// Graph
export * from './graph/index.js';

// Executor
export * from './executor/index.js';

