/**
 * Investigation Graph Metadata
 *
 * SINGLE SOURCE OF TRUTH for graph structure.
 * All phases, agents, and node definitions live here.
 * Contracts/API should import from here, not define their own.
 *
 * This file defines:
 * - Investigation phases (derived from supervisor pattern)
 * - Graph nodes (actual node definitions from graph.ts)
 * - Agent names (canonical list)
 * - Helper functions for graph analysis
 */

// =============================================================================
// INVESTIGATION PHASES
// =============================================================================

/**
 * Investigation workflow phases.
 * Derived from the supervisor pattern implementation.
 */
export const INVESTIGATION_PHASES = {
	pre_gathering: {
		label: "Pre-Gathering",
		description: "Loading context and preparing data",
	},
	gathering: {
		label: "Gathering",
		description: "Collecting logs, code, and change data",
	},
	targeted_gather: {
		label: "Targeted Gathering",
		description: "Additional gathering based on hypotheses",
	},
	analyzing: {
		label: "Analyzing",
		description: "Detective forming hypotheses",
	},
	challenging: {
		label: "Challenging",
		description: "Adversary validating hypotheses",
	},
	fixing: {
		label: "Fixing",
		description: "Surgeon proposing fixes",
	},
	complete: {
		label: "Complete",
		description: "Investigation finished",
	},
} as const;

export type InvestigationPhase = keyof typeof INVESTIGATION_PHASES;

export const INVESTIGATION_PHASE_NAMES = Object.keys(
	INVESTIGATION_PHASES,
) as InvestigationPhase[];

// =============================================================================
// GRAPH NODE TYPES
// =============================================================================

/**
 * Types of nodes in the investigation graph.
 */
export const GRAPH_NODE_TYPES = {
	system: "System node for internal processing",
	orchestrator: "Orchestration node (supervisor, coordinator)",
	gatherer: "Data gathering agent",
	analyzer: "Analysis agent (detective, adversary)",
	fixer: "Fix proposal agent (surgeon)",
} as const;

export type GraphNodeType = keyof typeof GRAPH_NODE_TYPES;

// =============================================================================
// GRAPH NODES
// =============================================================================

/**
 * Graph nodes - matches actual graph.ts node definitions.
 * Each node has a phase, type, and label.
 */
export const GRAPH_NODES = {
	// Pre-processing nodes
	validateIncident: {
		phase: "pre_gathering" as InvestigationPhase,
		type: "system" as GraphNodeType,
		label: "Validate Incident",
	},
	preGather: {
		phase: "pre_gathering" as InvestigationPhase,
		type: "system" as GraphNodeType,
		label: "Pre-Gather Context",
	},
	cloneIfNeeded: {
		phase: "pre_gathering" as InvestigationPhase,
		type: "system" as GraphNodeType,
		label: "Clone Repository",
	},
	prepareSupervisor: {
		phase: "pre_gathering" as InvestigationPhase,
		type: "system" as GraphNodeType,
		label: "Prepare Supervisor",
	},

	// Supervisor loop nodes
	supervisor: {
		phase: null as InvestigationPhase | null,
		type: "orchestrator" as GraphNodeType,
		label: "Supervisor",
	},
	qualityGate: {
		phase: null as InvestigationPhase | null,
		type: "system" as GraphNodeType,
		label: "Quality Gate",
	},
	processHandoff: {
		phase: null as InvestigationPhase | null,
		type: "system" as GraphNodeType,
		label: "Process Handoff",
	},
	"gatherer-coordinator": {
		phase: "gathering" as InvestigationPhase,
		type: "orchestrator" as GraphNodeType,
		label: "Gatherer Coordinator",
	},

	// Gatherer agents
	"log-gatherer": {
		phase: "gathering" as InvestigationPhase,
		type: "gatherer" as GraphNodeType,
		label: "Log Gatherer",
	},
	"code-searcher": {
		phase: "gathering" as InvestigationPhase,
		type: "gatherer" as GraphNodeType,
		label: "Code Searcher",
	},
	"change-tracker": {
		phase: "gathering" as InvestigationPhase,
		type: "gatherer" as GraphNodeType,
		label: "Change Tracker",
	},

	// Analysis agents
	detective: {
		phase: "analyzing" as InvestigationPhase,
		type: "analyzer" as GraphNodeType,
		label: "Detective",
	},
	adversary: {
		phase: "challenging" as InvestigationPhase,
		type: "analyzer" as GraphNodeType,
		label: "Adversary",
	},

	// Fix agent
	surgeon: {
		phase: "fixing" as InvestigationPhase,
		type: "fixer" as GraphNodeType,
		label: "Surgeon",
	},

	// Output node
	writeToApi: {
		phase: "complete" as InvestigationPhase,
		type: "system" as GraphNodeType,
		label: "Write Results",
	},
} as const;

export type GraphNodeId = keyof typeof GRAPH_NODES;

export const GRAPH_NODE_IDS = Object.keys(GRAPH_NODES) as GraphNodeId[];

// =============================================================================
// AGENT NAMES
// =============================================================================

/**
 * Canonical list of agent names.
 * These are the actual agents that perform work (not system/orchestrator nodes).
 */
export const AGENT_NAMES = [
	"log-gatherer",
	"code-searcher",
	"change-tracker",
	"detective",
	"adversary",
	"surgeon",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * Gatherer agent names (subset of AGENT_NAMES).
 */
export const GATHERER_NAMES = [
	"log-gatherer",
	"code-searcher",
	"change-tracker",
] as const;

export type GathererName = (typeof GATHERER_NAMES)[number];

/**
 * Analyzer agent names.
 */
export const ANALYZER_NAMES = ["detective", "adversary"] as const;

export type AnalyzerName = (typeof ANALYZER_NAMES)[number];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get graph nodes filtered by type.
 *
 * @example
 * const gatherers = getNodesByType("gatherer");
 * // Returns: ["log-gatherer", "code-searcher", "change-tracker"]
 */
export function getNodesByType(type: GraphNodeType): GraphNodeId[] {
	return (
		Object.entries(GRAPH_NODES) as [
			GraphNodeId,
			(typeof GRAPH_NODES)[GraphNodeId],
		][]
	)
		.filter(([, node]) => node.type === type)
		.map(([id]) => id);
}

/**
 * Get graph nodes filtered by phase.
 *
 * @example
 * const gatheringNodes = getNodesByPhase("gathering");
 * // Returns: ["gatherer-coordinator", "log-gatherer", "code-searcher", "change-tracker"]
 */
export function getNodesByPhase(phase: InvestigationPhase): GraphNodeId[] {
	return (
		Object.entries(GRAPH_NODES) as [
			GraphNodeId,
			(typeof GRAPH_NODES)[GraphNodeId],
		][]
	)
		.filter(([, node]) => node.phase === phase)
		.map(([id]) => id);
}

/**
 * Check if a node ID is a valid agent name.
 */
export function isAgentName(nodeId: string): nodeId is AgentName {
	return AGENT_NAMES.includes(nodeId as AgentName);
}

/**
 * Check if a node ID is a gatherer.
 */
export function isGatherer(nodeId: string): nodeId is GathererName {
	return GATHERER_NAMES.includes(nodeId as GathererName);
}

/**
 * Get node metadata by ID.
 */
export function getNodeMetadata(nodeId: GraphNodeId): {
	phase: InvestigationPhase | null;
	type: GraphNodeType;
	label: string;
} {
	return GRAPH_NODES[nodeId];
}

/**
 * Get phase metadata.
 */
export function getPhaseMetadata(phase: InvestigationPhase): {
	label: string;
	description: string;
} {
	return INVESTIGATION_PHASES[phase];
}
