// =============================================================================
// GRAPH INDEX
// =============================================================================
// Export LangGraph-related modules.
// =============================================================================

// Investigation Graph
// Note: buildInvestigationGraph and compileInvestigationGraph are internal to avoid
// TypeScript declaration portability issues with LangGraph's complex types.
// Use investigationGraph (for LangGraph Studio) or runInvestigation/resumeInvestigation (programmatic).
export {
	investigationGraph,
	resumeInvestigation,
	runInvestigation,
} from "./graph.js";

// Graph Metadata (Single Source of Truth for phases, nodes, agents)
export {
	INVESTIGATION_PHASES,
	INVESTIGATION_PHASE_NAMES,
	type InvestigationPhase,
	GRAPH_NODE_TYPES,
	type GraphNodeType,
	GRAPH_NODES,
	GRAPH_NODE_IDS,
	type GraphNodeId,
	AGENT_NAMES,
	type AgentName,
	GATHERER_NAMES,
	type GathererName,
	ANALYZER_NAMES,
	type AnalyzerName,
	getNodesByType,
	getNodesByPhase,
	isAgentName,
	isGatherer,
	getNodeMetadata,
	getPhaseMetadata,
} from "./metadata.js";

// Persistence
export {
	type CheckpointerConfig,
	closeCheckpointer,
	getCheckpoint,
	getCheckpointer,
	getInvocationConfig,
	getThreadId,
	hasExistingCheckpoint,
	listCheckpoints,
	resetCheckpointer,
	// Type-safe checkpoint state access helpers
	getStateFromCheckpoint,
	getCheckpointTimestamp,
} from "./persistence/checkpointer.js";
