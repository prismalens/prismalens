// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Transform CanonicalEvent stream into React Flow nodes and edges
 *
 * Converts real-time stream events into visual graph nodes live while an
 * investigation is running.
 */

import type {
	CanonicalEvent,
	ExecutionStatus,
	WorkflowStatus,
} from "@prismalens/contracts";
import type { Edge } from "reactflow";
import { MarkerType } from "reactflow";
import {
	type CanvasNode,
	calculateNodePosition,
	getAgentStyle,
	type TransformResult,
} from "./transform-executions";

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
				execution: undefined,
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
