// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Investigation Canvas Component
 *
 * Visualizes the agent execution flow from the investigation's canonical
 * event stream — live over SSE while running, replayed from the durable
 * event record once finished (GET /investigations/:id/events, ADR-0018).
 * Renders START → agent nodes → END. Both sources feed the same transform,
 * so there is exactly one rendering path regardless of run state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
	Background,
	Controls,
	MiniMap,
	type Node,
	ReactFlowProvider,
	useEdgesState,
	useNodesInitialized,
	useNodesState,
	useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";

import type { CanonicalEvent, WorkflowStatus } from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";
import { Loader2 } from "lucide-react";

import { AgentNode, CanvasExportMenu, StartEndNode } from "@/components/canvas";
import {
	type CanvasNode,
	getAgentMiniMapColor,
	transformLiveEventsToCanvas,
} from "@/lib/canvas";
import { NodeDetailsPanel } from "./canvas/NodeDetailsPanel";

// Register custom node types
const nodeTypes = {
	agent: AgentNode,
	startEnd: StartEndNode,
};

export interface InvestigationCanvasProps {
	status?: WorkflowStatus;
	investigationId?: string;
	/** Variant: 'full' (500px with all controls) or 'mini' (200px, simplified) */
	variant?: "full" | "mini";
	/** Callback when user wants to view full canvas (mini mode only) */
	onViewFull?: () => void;
	/**
	 * The canonical event stream — live SSE events while running, or the
	 * replayed durable record once finished. `undefined` means not yet
	 * loaded (see `streamConnecting`), distinct from `[]` (loaded, empty).
	 */
	streamEvents?: CanonicalEvent[];
	/** Whether the stream/replay fetch is still connecting (pre-first-event) */
	streamConnecting?: boolean;
}

export default function InvestigationCanvas(props: InvestigationCanvasProps) {
	return (
		<ReactFlowProvider>
			<InvestigationCanvasInner {...props} />
		</ReactFlowProvider>
	);
}

function InvestigationCanvasInner({
	status = "pending",
	investigationId,
	variant = "full",
	onViewFull,
	streamEvents,
	streamConnecting,
}: InvestigationCanvasProps) {
	const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
	const isMini = variant === "mini";

	// Transform the canonical event stream (live or replayed) to canvas nodes/edges
	const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
		return transformLiveEventsToCanvas(streamEvents ?? [], status);
	}, [status, streamEvents]);

	const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

	// Re-sync nodes and edges whenever initialNodes/initialEdges update
	useEffect(() => {
		setNodes(initialNodes);
		setEdges(initialEdges);
	}, [initialNodes, initialEdges, setNodes, setEdges]);

	// `fitView` runs once, at mount. That was enough for a one-shot replay of a
	// finished investigation; a running one appends nodes over the live stream
	// afterwards, so the newest node — precisely the one being watched — drifts
	// out of the viewport and the operator has to pan to follow their own
	// investigation. Re-fit as the graph grows, and only while actively
	// running, so a replayed/terminal render keeps its single mount-time fit.
	// `nodesInitialized` is the signal that the newly appended nodes have been
	// measured; fitting before that fits to zero-sized nodes and does nothing.
	const isLive = status === "running" || status === "pending";
	const { fitView } = useReactFlow();
	const nodesInitialized = useNodesInitialized();
	const nodeCount = nodes.length;
	useEffect(() => {
		if (!isLive || nodeCount === 0 || !nodesInitialized) {
			return;
		}
		fitView({ padding: isMini ? 0.1 : 0.2, duration: 200 });
	}, [nodeCount, nodesInitialized, isLive, fitView, isMini]);

	// Handle node click to show details
	const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
		// Only show details for agent nodes (not start/end)
		if (node.type === "agent") {
			setSelectedNode(node as CanvasNode);
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

	const showConnecting =
		Boolean(streamConnecting) &&
		(streamEvents ? streamEvents.length === 0 : nodes.length === 0);

	return (
		<div
			data-testid="investigation-canvas"
			className={`relative w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg ${
				isMini ? "h-[200px]" : "h-[500px]"
			}`}
		>
			{/* Export Menu - positioned top right (full mode only) */}
			{!isMini && !showConnecting && (
				<div className="absolute top-2 right-2 z-10">
					<CanvasExportMenu investigationId={investigationId} />
				</div>
			)}

			{/* View Full button (mini mode only) */}
			{isMini && onViewFull && !showConnecting && (
				<button
					type="button"
					onClick={onViewFull}
					className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-background/80 hover:bg-background border rounded shadow-sm"
				>
					View Full Canvas
				</button>
			)}

			{showConnecting ? (
				<div
					data-testid="canvas-stream-connecting"
					className="flex flex-col items-center justify-center h-full gap-2 text-sm text-muted-foreground"
				>
					<Loader2 className="h-5 w-5 animate-spin text-blue-500" />
					<span>Connecting to stream...</span>
				</div>
			) : (
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
					{!isMini && (
						<MiniMap nodeColor={minimapNodeColor} zoomable pannable />
					)}
				</ReactFlow>
			)}

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
