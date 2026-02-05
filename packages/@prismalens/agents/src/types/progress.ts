/**
 * Investigation Progress Types
 *
 * Types for tracking investigation progress and visualizing the graph.
 * Used by the Progress API to expose checkpoint data to the frontend.
 */

import type {
	InvestigationPhase,
	GraphNodeId,
	AgentName,
} from "../graph/metadata.js";
import type { HandoffRecord } from "../utils/handoff-manager.js";
import type { DataQualityInfo, Finding } from "./supervisor.js";
import type { Hypothesis, AgentExecutionRecord } from "./schemas/findings.js";

// =============================================================================
// INVESTIGATION STATUS
// =============================================================================

/**
 * Investigation execution status.
 */
export type InvestigationStatus =
	| "pending"
	| "validating"
	| "running"
	| "completed"
	| "failed";

// =============================================================================
// INVESTIGATION PROGRESS
// =============================================================================

/**
 * Current progress of an investigation.
 * Derived from LangGraph checkpoint data.
 */
export interface InvestigationProgress {
	/** Investigation ID */
	investigationId: string;

	/** Current execution status */
	status: InvestigationStatus;

	/** Current workflow phase */
	phase: InvestigationPhase;

	/** Currently executing graph node (if any) */
	currentNode: GraphNodeId | null;

	/** Currently executing agent (if any) */
	currentAgent: AgentName | null;

	/** Number of gathering iterations completed */
	gatherIterations: number;

	// Counts for summary display
	/** Total findings collected */
	findings: number;

	/** Total hypotheses formed */
	hypotheses: number;

	/** Best hypothesis confidence (0-100, null if no hypotheses) */
	confidence: number | null;

	// Rich data for visualization
	/** History of handoff requests between agents */
	handoffHistory: HandoffRecord[];

	/** Data quality information */
	dataQuality: DataQualityInfo | null;

	/** Agent execution records */
	agentExecutions: AgentExecutionRecord[];

	/** Timestamp of last update */
	updatedAt: string;
}

// =============================================================================
// PROGRESS SNAPSHOT (for timeline/history)
// =============================================================================

/**
 * Snapshot of progress at a point in time.
 * Used for building timeline views and progress history.
 */
export interface ProgressSnapshot {
	/** Timestamp of this snapshot */
	timestamp: string;

	/** Phase at this point */
	phase: InvestigationPhase;

	/** Node executing at this point */
	currentNode: GraphNodeId | null;

	/** Findings count at this point */
	findings: number;

	/** Hypotheses count at this point */
	hypotheses: number;

	/** Confidence at this point */
	confidence: number | null;
}

// =============================================================================
// GRAPH VISUALIZATION STATE
// =============================================================================

/**
 * Status of a graph node for visualization.
 */
export type NodeStatus =
	| "pending"
	| "running"
	| "completed"
	| "skipped"
	| "failed";

/**
 * State of a graph node for UI rendering.
 */
export interface GraphNodeState {
	/** Node ID */
	id: GraphNodeId;

	/** Current status */
	status: NodeStatus;

	/** When the node started executing */
	startedAt?: string;

	/** When the node completed */
	completedAt?: string;

	/** Error message if failed */
	error?: string;

	/** Number of findings produced by this node (for agents) */
	findingsProduced?: number;
}

/**
 * Status of a graph edge for visualization.
 */
export type EdgeStatus = "pending" | "active" | "completed";

/**
 * State of a graph edge for UI rendering.
 */
export interface GraphEdgeState {
	/** Source node */
	from: GraphNodeId;

	/** Target node */
	to: GraphNodeId;

	/** Edge label (e.g., handoff reason) */
	label?: string;

	/** Current status */
	status: EdgeStatus;

	/** Timestamp when this edge was traversed */
	traversedAt?: string;
}

/**
 * Full graph visualization state.
 */
export interface GraphVisualizationState {
	/** All node states */
	nodes: GraphNodeState[];

	/** All edge states */
	edges: GraphEdgeState[];

	/** Currently active node (if any) */
	activeNodeId: GraphNodeId | null;

	/** Investigation phase */
	phase: InvestigationPhase;
}

// =============================================================================
// PROGRESS UPDATE (for callbacks)
// =============================================================================

/**
 * Progress update emitted during investigation execution.
 * Used by callbacks to track progress in real-time.
 */
export interface ProgressUpdate {
	/** Investigation ID */
	investigationId: string;

	/** Current phase */
	phase: InvestigationPhase;

	/** Human-readable progress message */
	message: string;

	/** Progress percentage (0-100, optional) */
	progress?: number;

	/** Current agent (if any) */
	currentAgent?: AgentName;

	/** Additional metadata */
	metadata?: Record<string, unknown>;
}
