"use client";

/**
 * Investigation Canvas Component
 *
 * Visualizes the LangGraph agent execution flow dynamically from AgentExecution data.
 * Renders START → agent nodes → END based on actual database records.
 */

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
	Background,
	Controls,
	MiniMap,
	type Node,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";

import type {
	AgentExecutionWithTools,
	WorkflowStatus,
} from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";

import { AgentNode, CanvasExportMenu, StartEndNode } from "@/components/canvas";
import {
	getAgentMiniMapColor,
	transformExecutionsToCanvas,
} from "@/lib/canvas";
import { NodeDetailsPanel } from "./canvas/NodeDetailsPanel";

// Register custom node types
const nodeTypes = {
	agent: AgentNode,
	startEnd: StartEndNode,
};

export interface InvestigationCanvasProps {
	agentExecutions?: AgentExecutionWithTools[];
	status?: WorkflowStatus;
	investigationId?: string;
	/** Variant: 'full' (500px with all controls) or 'mini' (200px, simplified) */
	variant?: "full" | "mini";
	/** Callback when user wants to view full canvas (mini mode only) */
	onViewFull?: () => void;
}

export default function InvestigationCanvas(props: InvestigationCanvasProps) {
	return (
		<ReactFlowProvider>
			<InvestigationCanvasInner {...props} />
		</ReactFlowProvider>
	);
}

function InvestigationCanvasInner({
	agentExecutions = [],
	status = "pending",
	investigationId,
	variant = "full",
	onViewFull,
}: InvestigationCanvasProps) {
	const [selectedNode, setSelectedNode] = useState<Node | null>(null);
	const isMini = variant === "mini";

	// Transform executions to canvas nodes/edges
	const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
		return transformExecutionsToCanvas(agentExecutions, status);
	}, [agentExecutions, status]);

	const [nodes, , onNodesChange] = useNodesState(initialNodes);
	const [edges, , onEdgesChange] = useEdgesState(initialEdges);

	// Handle node click to show details
	const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
		// Only show details for agent nodes (not start/end)
		if (node.type === "agent" && node.data.execution) {
			setSelectedNode(node);
		}
	}, []);

	const onPaneClick = useCallback(() => {
		setSelectedNode(null);
	}, []);

	// MiniMap node colors based on agent type (dynamic)
	const minimapNodeColor = useCallback((node: Node) => {
		if (node.type === "startEnd") {
			return node.data.status === "failed"
				? chartColors.node.error
				: chartColors.node.default;
		}
		if (node.type === "agent" && node.data.agentName) {
			return getAgentMiniMapColor(node.data.agentName);
		}
		return chartColors.node.default;
	}, []);

	return (
		<div
			className={`relative w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg ${
				isMini ? "h-[200px]" : "h-[500px]"
			}`}
		>
			{/* Export Menu - positioned top right (full mode only) */}
			{!isMini && (
				<div className="absolute top-2 right-2 z-10">
					<CanvasExportMenu
						agentExecutions={agentExecutions}
						investigationId={investigationId}
					/>
				</div>
			)}

			{/* View Full button (mini mode only) */}
			{isMini && onViewFull && (
				<button
					type="button"
					onClick={onViewFull}
					className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-background/80 hover:bg-background border rounded shadow-sm"
				>
					View Full Canvas
				</button>
			)}

			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeClick={isMini ? undefined : onNodeClick}
				onPaneClick={isMini ? undefined : onPaneClick}
				nodeTypes={nodeTypes}
				fitView
				fitViewOptions={{ padding: isMini ? 0.1 : 0.2 }}
				attributionPosition="bottom-left"
				proOptions={{ hideAttribution: true }}
				panOnDrag={!isMini}
				zoomOnScroll={!isMini}
				zoomOnPinch={!isMini}
				zoomOnDoubleClick={!isMini}
				nodesDraggable={!isMini}
				nodesConnectable={false}
				elementsSelectable={!isMini}
			>
				<Background color={chartColors.muted} gap={isMini ? 12 : 16} />
				{!isMini && <Controls />}
				{!isMini && <MiniMap nodeColor={minimapNodeColor} zoomable pannable />}
			</ReactFlow>

			{/* Node Details Panel (full mode only) */}
			{!isMini && (
				<NodeDetailsPanel
					node={selectedNode}
					onClose={() => setSelectedNode(null)}
				/>
			)}
		</div>
	);
}
