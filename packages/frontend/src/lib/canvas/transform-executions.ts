/**
 * Transform AgentExecution data into React Flow nodes and edges
 *
 * Converts the flat list of AgentExecution records into a visual graph
 * representation for the Investigation Canvas.
 */

import type { Edge, Node } from "reactflow";
import { MarkerType } from "reactflow";
import type {
	AgentExecutionWithTools,
	ExecutionStatus,
	WorkflowStatus,
} from "@prismalens/contracts";
import type { LucideIcon } from "lucide-react";
import {
	AlertCircle,
	Brain,
	CheckCircle,
	Cog,
	Database,
	Search,
	Stethoscope,
} from "lucide-react";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentStyle {
	bg: string;
	border: string;
	textColor: string;
	iconColor: string;
	displayName: string;
	icon: LucideIcon;
}

export interface CanvasNode extends Node {
	data: {
		label: string;
		status: ExecutionStatus | "pending";
		agentName?: string;
		executionTimeMs?: number | null;
		toolCount?: number;
		confidence?: number | null;
		inputTokens?: number | null;
		outputTokens?: number | null;
		error?: string | null;
		execution?: AgentExecutionWithTools;
	};
}

export interface TransformResult {
	nodes: CanvasNode[];
	edges: Edge[];
}

// =============================================================================
// DYNAMIC AGENT STYLING
// =============================================================================

/**
 * Generate a consistent hash from a string
 * Used for deterministic color generation based on agent name
 */
function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash) + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

/**
 * Convert snake_case or camelCase to Title Case
 * Examples:
 *   'incident_commander' → 'Incident Commander'
 *   'cartographer' → 'Cartographer'
 *   'validateAlerts' → 'Validate Alerts'
 */
function formatAgentName(name: string): string {
	return name
		.replace(/_/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generate dynamic agent style based on agent name
 * Uses hash-based color generation for consistent colors
 */
function generateAgentStyle(agentName: string): AgentStyle {
	const hash = hashString(agentName);
	const hue = hash % 360;

	return {
		bg: `bg-[hsl(${hue},70%,95%)] dark:bg-[hsl(${hue},40%,15%)]`,
		border: `border-[hsl(${hue},60%,60%)] dark:border-[hsl(${hue},50%,40%)]`,
		textColor: `text-[hsl(${hue},80%,30%)] dark:text-[hsl(${hue},70%,70%)]`,
		iconColor: `text-[hsl(${hue},70%,45%)]`,
		displayName: formatAgentName(agentName),
		icon: Cog,
	};
}

/**
 * Known agents with custom display names and icons
 * New agents are automatically supported via dynamic generation
 */
const KNOWN_AGENT_OVERRIDES: Record<string, Partial<AgentStyle>> = {
	// Main orchestrator
	incident_commander: { displayName: "Commander", icon: Brain },

	// Sub-agents
	cartographer: { displayName: "Cartographer", icon: Search },
	detective: { displayName: "Detective", icon: AlertCircle },
	surgeon: { displayName: "Surgeon", icon: Stethoscope },

	// Graph nodes (LangGraph workflow nodes)
	validateAlerts: { displayName: "Validate Alerts", icon: CheckCircle },
	runCommander: { displayName: "Run Commander", icon: Brain },
	writeToApi: { displayName: "Save Results", icon: Database },

};

/**
 * Get agent style (dynamic with optional overrides for known agents)
 * Supports ANY agent name - new agents automatically get styled
 */
export function getAgentStyle(agentName: string): AgentStyle {
	const generated = generateAgentStyle(agentName);
	const override = KNOWN_AGENT_OVERRIDES[agentName];

	if (override) {
		return {
			...generated,
			...override,
			icon: override.icon ?? generated.icon,
		};
	}

	return generated;
}

/**
 * Get minimap node color based on agent name
 * Uses hash-based color generation for consistency
 */
export function getAgentMiniMapColor(agentName: string): string {
	const hash = hashString(agentName);
	const hue = hash % 360;
	return `hsl(${hue}, 70%, 85%)`;
}

// =============================================================================
// POSITION CALCULATION
// =============================================================================

const NODE_WIDTH = 240;
const NODE_HEIGHT = 100;
const VERTICAL_SPACING = 40;
const START_X = 250;
const START_Y = 0;

function calculateNodePosition(index: number, totalNodes: number) {
	// Simple vertical layout for now
	// Future: could support branching for parallel executions
	return {
		x: START_X,
		y: START_Y + index * (NODE_HEIGHT + VERTICAL_SPACING),
	};
}

// =============================================================================
// TRANSFORM FUNCTION
// =============================================================================

/**
 * Transform AgentExecution records into React Flow nodes and edges
 *
 * @param agentExecutions - Array of agent executions from the API
 * @param investigationStatus - Current status of the investigation
 * @returns Nodes and edges for React Flow
 */
export function transformExecutionsToCanvas(
	agentExecutions: AgentExecutionWithTools[],
	investigationStatus: WorkflowStatus,
): TransformResult {
	const nodes: CanvasNode[] = [];
	const edges: Edge[] = [];

	// Sort executions by startedAt (nulls last, then pending)
	const sortedExecutions = [...agentExecutions].sort((a, b) => {
		if (!a.startedAt && !b.startedAt) return 0;
		if (!a.startedAt) return 1;
		if (!b.startedAt) return -1;
		return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
	});

	// Create START node
	const startNodeId = "start";
	nodes.push({
		id: startNodeId,
		type: "startEnd",
		position: calculateNodePosition(0, sortedExecutions.length + 2),
		data: {
			label: "START",
			status: "completed",
		},
	});

	// Create agent nodes from executions
	let previousNodeId = startNodeId;

	sortedExecutions.forEach((execution, index) => {
		const nodeId = `agent-${execution.id}`;
		const style = getAgentStyle(execution.agentName);
		const toolCount = execution.toolExecutions?.length ?? 0;

		nodes.push({
			id: nodeId,
			type: "agent",
			position: calculateNodePosition(index + 1, sortedExecutions.length + 2),
			data: {
				label: style.displayName,
				status: execution.status as ExecutionStatus,
				agentName: execution.agentName,
				executionTimeMs: execution.executionTimeMs,
				toolCount,
				confidence: execution.confidence,
				inputTokens: execution.inputTokens,
				outputTokens: execution.outputTokens,
				error: execution.error,
				execution,
			},
		});

		// Create edge from previous node
		const isAnimated =
			execution.status === "running" ||
			(execution.status === "pending" &&
				investigationStatus === "running");

		edges.push({
			id: `edge-${previousNodeId}-${nodeId}`,
			source: previousNodeId,
			target: nodeId,
			animated: isAnimated,
			markerEnd: { type: MarkerType.ArrowClosed },
			style: {
				strokeWidth: 2,
			},
		});

		previousNodeId = nodeId;
	});

	// Create END node if investigation is completed or failed
	if (
		investigationStatus === "completed" ||
		investigationStatus === "failed"
	) {
		const endNodeId = "end";
		nodes.push({
			id: endNodeId,
			type: "startEnd",
			position: calculateNodePosition(
				sortedExecutions.length + 1,
				sortedExecutions.length + 2,
			),
			data: {
				label: investigationStatus === "failed" ? "FAILED" : "END",
				status: investigationStatus === "failed" ? "failed" : "completed",
			},
		});

		edges.push({
			id: `edge-${previousNodeId}-${endNodeId}`,
			source: previousNodeId,
			target: endNodeId,
			animated: false,
			markerEnd: { type: MarkerType.ArrowClosed },
			style: {
				strokeWidth: 2,
			},
		});
	}

	return { nodes, edges };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format execution time for display
 */
export function formatExecutionTime(ms: number | null | undefined): string {
	if (!ms) return "-";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.round((ms % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}

/**
 * Format token count for display
 */
export function formatTokenCount(
	input: number | null | undefined,
	output: number | null | undefined,
): string {
	if (!input && !output) return "-";
	const parts: string[] = [];
	if (input) parts.push(`${input.toLocaleString()} in`);
	if (output) parts.push(`${output.toLocaleString()} out`);
	return parts.join(" / ");
}

/**
 * Get status color for styling
 */
export function getStatusColor(status: ExecutionStatus | "pending"): string {
	switch (status) {
		case "completed":
			return "text-green-500";
		case "running":
			return "text-blue-500";
		case "failed":
			return "text-red-500";
		case "pending":
		default:
			return "text-zinc-400";
	}
}
