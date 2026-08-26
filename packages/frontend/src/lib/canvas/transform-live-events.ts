// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Transform CanonicalEvent stream into React Flow nodes and edges
 *
 * Converts a canonical event stream into visual graph nodes — live while an
 * investigation is running, or replayed from the durable event record (GET
 * /investigations/:id/events, ADR-0018) once it has finished. Both paths
 * produce the same event shape, so this is the investigation canvas's only
 * transform: there is no separate "completed run" data source (retired
 * AgentExecution/ToolExecution — #417).
 */

import {
	AGENT_IDS,
	type AgentId,
	type AgentRole,
	INVESTIGATION_AGENTS,
} from "@prismalens/config/agents";
import type {
	CanonicalEvent,
	ExecutionStatus,
	WorkflowStatus,
} from "@prismalens/contracts";
import type { LucideIcon } from "lucide-react";
import { Brain, Cog, Compass, Wrench } from "lucide-react";
import type { Edge, Node } from "reactflow";
import { MarkerType } from "reactflow";

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
		inputTokens?: number | null;
		outputTokens?: number | null;
		error?: string | null;
	};
}

export interface TransformResult {
	nodes: CanvasNode[];
	edges: Edge[];
}

// =============================================================================
// DYNAMIC AGENT STYLING
// =============================================================================

export interface AgentPalette {
	bg: string;
	border: string;
	textColor: string;
	iconColor: string;
}

/**
 * Bounded, statically-written palettes selected by hash bucket (#408).
 * Every class string appears verbatim in source so Tailwind's scanner finds it.
 * Colors follow @prismalens/design-tokens vocabulary (indigo, purple, emerald,
 * amber, sky, rose, cyan, violet) with high contrast in both light and dark modes.
 */
export const AGENT_PALETTES: readonly AgentPalette[] = [
	{
		bg: "bg-indigo-50 dark:bg-indigo-950/60",
		border: "border-indigo-200 dark:border-indigo-800",
		textColor: "text-indigo-900 dark:text-indigo-100",
		iconColor: "text-indigo-600 dark:text-indigo-400",
	},
	{
		bg: "bg-purple-50 dark:bg-purple-950/60",
		border: "border-purple-200 dark:border-purple-800",
		textColor: "text-purple-900 dark:text-purple-100",
		iconColor: "text-purple-600 dark:text-purple-400",
	},
	{
		bg: "bg-emerald-50 dark:bg-emerald-950/60",
		border: "border-emerald-200 dark:border-emerald-800",
		textColor: "text-emerald-900 dark:text-emerald-100",
		iconColor: "text-emerald-600 dark:text-emerald-400",
	},
	{
		bg: "bg-amber-50 dark:bg-amber-950/60",
		border: "border-amber-200 dark:border-amber-800",
		textColor: "text-amber-900 dark:text-amber-100",
		iconColor: "text-amber-600 dark:text-amber-400",
	},
	{
		bg: "bg-sky-50 dark:bg-sky-950/60",
		border: "border-sky-200 dark:border-sky-800",
		textColor: "text-sky-900 dark:text-sky-100",
		iconColor: "text-sky-600 dark:text-sky-400",
	},
	{
		bg: "bg-rose-50 dark:bg-rose-950/60",
		border: "border-rose-200 dark:border-rose-800",
		textColor: "text-rose-900 dark:text-rose-100",
		iconColor: "text-rose-600 dark:text-rose-400",
	},
	{
		bg: "bg-cyan-50 dark:bg-cyan-950/60",
		border: "border-cyan-200 dark:border-cyan-800",
		textColor: "text-cyan-900 dark:text-cyan-100",
		iconColor: "text-cyan-600 dark:text-cyan-400",
	},
	{
		bg: "bg-violet-50 dark:bg-violet-950/60",
		border: "border-violet-200 dark:border-violet-800",
		textColor: "text-violet-900 dark:text-violet-100",
		iconColor: "text-violet-600 dark:text-violet-400",
	},
] as const;

/**
 * Generate a consistent hash from a string
 * Used for deterministic color generation based on agent name
 */
function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

/**
 * Convert snake_case or camelCase to Title Case
 * Examples:
 *   'gatherer' → 'Gatherer'
 *   'validateAlerts' → 'Validate Alerts'
 */
function formatAgentName(name: string): string {
	return name
		.replace(/_/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generate agent styling by selecting a static palette bucket based on agent name hash (#408).
 * All class names are statically declared so Tailwind compiler extracts them to CSS.
 */
function generateAgentStyle(agentName: string): AgentStyle {
	const hash = hashString(agentName);
	const palette = AGENT_PALETTES[hash % AGENT_PALETTES.length];

	return {
		...palette,
		displayName: formatAgentName(agentName),
		icon: Cog,
	};
}

/**
 * Icon per agent *role* (`entry` / `worker` / `orchestrator`), not per agent
 * name. Nothing here names an individual agent, so adding, renaming, or
 * retiring an entry in the `@prismalens/config/agents` SSOT needs no change
 * in this file — a previous version hardcoded one entry per agent name and
 * silently kept `cartographer`/`detective`/`surgeon` around for a month after
 * the roster moved on.
 */
const ROLE_ICONS: Record<AgentRole, LucideIcon> = {
	entry: Compass,
	worker: Wrench,
	orchestrator: Brain,
};

function isRegisteredAgentId(agentName: string): agentName is AgentId {
	return (AGENT_IDS as readonly string[]).includes(agentName);
}

/**
 * Get agent style (dynamic with optional overrides for known agents)
 * Supports ANY agent name - new agents automatically get styled
 *
 * `agent_step.label` on the stream is intentionally free text (it can name a
 * dynamically spawned subagent outside the registry), so any name not in
 * `INVESTIGATION_AGENTS` still gets a usable style via `generateAgentStyle`
 * below — the registry only sharpens the look of the fixed roster, it does
 * not gate which names are valid.
 */
export function getAgentStyle(agentName: string): AgentStyle {
	const generated = generateAgentStyle(agentName);

	if (!isRegisteredAgentId(agentName)) {
		return generated;
	}

	const agent = INVESTIGATION_AGENTS[agentName];
	return {
		...generated,
		displayName: agent.name,
		icon: ROLE_ICONS[agent.role],
	};
}

/**
 * MiniMap node fill hue matches the canvas node; lightness drops in dark mode
 * so nodes contrast against the dark card background (#436).
 */
export function getAgentMiniMapColor(
	agentName: string,
	theme: "light" | "dark" = "light",
): string {
	const hash = hashString(agentName);
	const hue = hash % 360;
	return theme === "dark" ? `hsl(${hue}, 50%, 40%)` : `hsl(${hue}, 70%, 85%)`;
}

// =============================================================================
// POSITION CALCULATION
// =============================================================================

export const NODE_HEIGHT = 100;
export const VERTICAL_SPACING = 40;
export const START_X = 250;
export const START_Y = 0;

export function calculateNodePosition(index: number, _totalNodes: number) {
	// Simple vertical layout for now
	// Future: could support branching for parallel executions
	return {
		x: START_X,
		y: START_Y + index * (NODE_HEIGHT + VERTICAL_SPACING),
	};
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

// =============================================================================
// TRANSFORM FUNCTION
// =============================================================================

interface LiveNodeState {
	id: string;
	branchId: string;
	label: string;
	agentName: string;
	status: ExecutionStatus;
	toolCount: number;
	error?: string;
}

export function transformLiveEventsToCanvas(
	events: CanonicalEvent[],
	investigationStatus: WorkflowStatus,
): TransformResult {
	const nodeStateMap = new Map<string, LiveNodeState>();
	const branchLatestNodeKeyMap = new Map<string, string>();
	const branchNodesMap = new Map<string, string[]>();
	const insertionOrder: string[] = [];

	for (const event of events) {
		if (event.kind === "report" || event.kind === "llm_call") {
			continue;
		}

		const { branchId } = event;

		if (event.kind === "agent_step") {
			const subagentLabel = event.label ?? branchId;
			const nodeKey = `${branchId}:${subagentLabel}`;
			const syntheticId = `live:${branchId}:${subagentLabel}`;

			if (!nodeStateMap.has(nodeKey)) {
				const style = getAgentStyle(subagentLabel);
				const state: LiveNodeState = {
					id: syntheticId,
					branchId,
					label: style.displayName,
					agentName: subagentLabel,
					status: "running",
					toolCount: 0,
				};
				nodeStateMap.set(nodeKey, state);
				insertionOrder.push(nodeKey);

				const branchNodes = branchNodesMap.get(branchId) ?? [];
				branchNodes.push(nodeKey);
				branchNodesMap.set(branchId, branchNodes);
			}

			branchLatestNodeKeyMap.set(branchId, nodeKey);
		} else if (event.kind === "tool_result") {
			const latestNodeKey = branchLatestNodeKeyMap.get(branchId);
			if (latestNodeKey) {
				const nodeState = nodeStateMap.get(latestNodeKey);
				if (nodeState) {
					nodeState.toolCount += 1;
				}
			}
		} else if (event.kind === "branch_done") {
			const branchNodes = branchNodesMap.get(branchId) ?? [];
			for (const key of branchNodes) {
				const nodeState = nodeStateMap.get(key);
				if (nodeState && nodeState.status === "running") {
					nodeState.status = "completed";
				}
			}
		} else if (event.kind === "error") {
			const latestNodeKey = branchLatestNodeKeyMap.get(branchId);
			if (latestNodeKey) {
				const nodeState = nodeStateMap.get(latestNodeKey);
				if (nodeState) {
					nodeState.status = "failed";
					nodeState.error = event.message;
				}
			}
		}
	}

	if (insertionOrder.length === 0) {
		return { nodes: [], edges: [] };
	}

	const nodes: CanvasNode[] = [];
	const edges: Edge[] = [];
	const totalNodesCount = insertionOrder.length + 2;

	// Create START node
	const startNodeId = "start";
	nodes.push({
		id: startNodeId,
		type: "startEnd",
		position: calculateNodePosition(0, totalNodesCount),
		data: {
			label: "START",
			status: "completed",
		},
	});

	let previousNodeId = startNodeId;

	insertionOrder.forEach((nodeKey, index) => {
		const state = nodeStateMap.get(nodeKey);
		if (!state) return;

		nodes.push({
			id: state.id,
			type: "agent",
			position: calculateNodePosition(index + 1, totalNodesCount),
			data: {
				label: state.label,
				status: state.status,
				agentName: state.agentName,
				executionTimeMs: undefined,
				toolCount: state.toolCount,
				inputTokens: undefined,
				outputTokens: undefined,
				error: state.error ?? null,
			},
		});

		const isAnimated = state.status === "running";

		edges.push({
			id: `edge-${previousNodeId}-${state.id}`,
			source: previousNodeId,
			target: state.id,
			animated: isAnimated,
			markerEnd: { type: MarkerType.ArrowClosed },
			style: {
				strokeWidth: 2,
			},
		});

		previousNodeId = state.id;
	});

	// Create END node if investigation is completed or failed
	if (investigationStatus === "completed" || investigationStatus === "failed") {
		const endNodeId = "end";
		nodes.push({
			id: endNodeId,
			type: "startEnd",
			position: calculateNodePosition(
				insertionOrder.length + 1,
				totalNodesCount,
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
