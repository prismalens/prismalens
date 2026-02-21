"use client";

/**
 * Investigation Graph Component
 *
 * Real-time visualization of investigation progress using LangGraph checkpoint data.
 * Shows the agent workflow graph with live updates during investigation execution.
 */

import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
	Background,
	Controls,
	MiniMap,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	type Node,
	type Edge,
	Position,
} from "reactflow";
import "reactflow/dist/style.css";

import type {
	InvestigationProgressType,
	ProgressSnapshotType,
} from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";
import { useInvestigationProgress, useInvestigationProgressHistory } from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { Loader2, CheckCircle, XCircle, Clock, PlayCircle } from "lucide-react";

// Custom node component for investigation graph
function InvestigationNode({ data }: { data: InvestigationNodeData }) {
	const statusColors = {
		pending: "bg-zinc-200 border-zinc-300",
		running: "bg-blue-100 border-blue-400 animate-pulse",
		completed: "bg-green-100 border-green-400",
		skipped: "bg-gray-100 border-gray-300",
		failed: "bg-red-100 border-red-400",
	};

	const statusIcons = {
		pending: <Clock className="h-4 w-4 text-zinc-500" />,
		running: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
		completed: <CheckCircle className="h-4 w-4 text-green-500" />,
		skipped: <Clock className="h-4 w-4 text-gray-400" />,
		failed: <XCircle className="h-4 w-4 text-red-500" />,
	};

	const typeColors = {
		system: "text-zinc-600",
		orchestrator: "text-purple-600",
		gatherer: "text-blue-600",
		analyzer: "text-orange-600",
		fixer: "text-green-600",
	};

	return (
		<div
			className={`px-4 py-2 rounded-lg border-2 shadow-sm min-w-[140px] ${
				statusColors[data.status]
			}`}
		>
			<div className="flex items-center gap-2">
				{statusIcons[data.status]}
				<div>
					<div className="font-medium text-sm">{data.label}</div>
					<div className={`text-xs ${typeColors[data.type]}`}>{data.type}</div>
				</div>
			</div>
			{data.findingsProduced !== undefined && data.findingsProduced > 0 && (
				<div className="mt-1 text-xs text-muted-foreground">
					{data.findingsProduced} findings
				</div>
			)}
		</div>
	);
}

// Node types registration
const nodeTypes = {
	investigation: InvestigationNode,
};

interface InvestigationNodeData {
	label: string;
	type: "system" | "orchestrator" | "gatherer" | "analyzer" | "fixer";
	status: "pending" | "running" | "completed" | "skipped" | "failed";
	findingsProduced?: number;
}

export interface InvestigationGraphProps {
	investigationId: string;
	/** Whether to enable live polling */
	live?: boolean;
	/** Polling interval in ms (default: 2000) */
	pollingInterval?: number;
	/** Height of the graph container */
	height?: string | number;
}

/**
 * Build graph nodes and edges from investigation progress.
 */
function buildGraphFromProgress(
	progress: InvestigationProgressType | null,
	history: ProgressSnapshotType[] | undefined,
): { nodes: Node[]; edges: Edge[] } {
	// Define the standard investigation workflow
	const graphDefinition = [
		{ id: "validateIncident", label: "Validate", type: "system" as const, x: 0, y: 0 },
		{ id: "preGather", label: "Pre-Gather", type: "system" as const, x: 200, y: 0 },
		{ id: "cloneIfNeeded", label: "Clone Repo", type: "system" as const, x: 400, y: 0 },
		{ id: "supervisor", label: "Supervisor", type: "orchestrator" as const, x: 600, y: 0 },
		{ id: "gatherer-coordinator", label: "Gather Coord", type: "orchestrator" as const, x: 600, y: 120 },
		{ id: "log-gatherer", label: "Log Gatherer", type: "gatherer" as const, x: 400, y: 180 },
		{ id: "code-searcher", label: "Code Searcher", type: "gatherer" as const, x: 600, y: 180 },
		{ id: "change-tracker", label: "Change Tracker", type: "gatherer" as const, x: 800, y: 180 },
		{ id: "qualityGate", label: "Quality Gate", type: "system" as const, x: 800, y: 60 },
		{ id: "detective", label: "Detective", type: "analyzer" as const, x: 1000, y: 0 },
		{ id: "adversary", label: "Adversary", type: "analyzer" as const, x: 1000, y: 120 },
		{ id: "surgeon", label: "Surgeon", type: "fixer" as const, x: 1200, y: 0 },
		{ id: "writeToApi", label: "Complete", type: "system" as const, x: 1400, y: 0 },
	];

	// Determine node statuses based on progress
	const getNodeStatus = (nodeId: string): InvestigationNodeData["status"] => {
		if (!progress) return "pending";

		// Current node is running
		if (progress.currentNode === nodeId || progress.currentAgent === nodeId) {
			return "running";
		}

		// Check if node was visited in history
		const wasVisited = history?.some((snap) => snap.currentNode === nodeId);

		// Determine status based on phase progression
		const phaseOrder = [
			"pre_gathering",
			"gathering",
			"targeted_gather",
			"analyzing",
			"challenging",
			"fixing",
			"complete",
		];
		const currentPhaseIndex = phaseOrder.indexOf(progress.phase);

		// Map nodes to phases
		const nodePhases: Record<string, string> = {
			validateIncident: "pre_gathering",
			preGather: "pre_gathering",
			cloneIfNeeded: "pre_gathering",
			supervisor: "gathering",
			"gatherer-coordinator": "gathering",
			"log-gatherer": "gathering",
			"code-searcher": "gathering",
			"change-tracker": "gathering",
			qualityGate: "analyzing",
			detective: "analyzing",
			adversary: "challenging",
			surgeon: "fixing",
			writeToApi: "complete",
		};

		const nodePhase = nodePhases[nodeId];
		const nodePhaseIndex = phaseOrder.indexOf(nodePhase);

		if (nodePhaseIndex < currentPhaseIndex) {
			return "completed";
		}

		if (wasVisited) {
			return "completed";
		}

		// Failed state
		if (progress.status === "failed" && nodePhaseIndex <= currentPhaseIndex) {
			return "failed";
		}

		return "pending";
	};

	// Build nodes
	const nodes: Node[] = graphDefinition.map((nodeDef) => ({
		id: nodeDef.id,
		type: "investigation",
		position: { x: nodeDef.x, y: nodeDef.y },
		data: {
			label: nodeDef.label,
			type: nodeDef.type,
			status: getNodeStatus(nodeDef.id),
			findingsProduced:
				progress?.currentNode === nodeDef.id || progress?.currentAgent === nodeDef.id
					? progress.findings
					: undefined,
		} as InvestigationNodeData,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
	}));

	// Build edges (simplified workflow)
	const edges: Edge[] = [
		{ id: "e1", source: "validateIncident", target: "preGather" },
		{ id: "e2", source: "preGather", target: "cloneIfNeeded" },
		{ id: "e3", source: "cloneIfNeeded", target: "supervisor" },
		{ id: "e4", source: "supervisor", target: "gatherer-coordinator", label: "gather" },
		{ id: "e5", source: "gatherer-coordinator", target: "log-gatherer" },
		{ id: "e6", source: "gatherer-coordinator", target: "code-searcher" },
		{ id: "e7", source: "gatherer-coordinator", target: "change-tracker" },
		{ id: "e8", source: "log-gatherer", target: "gatherer-coordinator" },
		{ id: "e9", source: "code-searcher", target: "gatherer-coordinator" },
		{ id: "e10", source: "change-tracker", target: "gatherer-coordinator" },
		{ id: "e11", source: "gatherer-coordinator", target: "supervisor" },
		{ id: "e12", source: "supervisor", target: "qualityGate", label: "analyze" },
		{ id: "e13", source: "qualityGate", target: "detective" },
		{ id: "e14", source: "detective", target: "supervisor" },
		{ id: "e15", source: "supervisor", target: "adversary", label: "challenge" },
		{ id: "e16", source: "adversary", target: "supervisor" },
		{ id: "e17", source: "supervisor", target: "surgeon", label: "fix" },
		{ id: "e18", source: "surgeon", target: "supervisor" },
		{ id: "e19", source: "supervisor", target: "writeToApi", label: "complete" },
	].map((e) => ({
		...e,
		type: "smoothstep",
		animated: progress?.currentNode === e.source,
		style: { stroke: chartColors.muted },
	}));

	return { nodes, edges };
}

function InvestigationGraphInner({
	investigationId,
	live = true,
	pollingInterval = 2000,
	height = 400,
}: InvestigationGraphProps) {
	const { data: progress, isLoading } = useInvestigationProgress(investigationId, {
		enabled: live,
		pollingInterval,
	});

	const { data: history } = useInvestigationProgressHistory(investigationId, {
		enabled: live,
	});

	// Build initial nodes/edges from current progress
	const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
		return buildGraphFromProgress(progress ?? null, history);
	}, [progress, history]);

	// ReactFlow state management - capture setNodes/setEdges for updates
	const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

	// Update ReactFlow state when progress or history changes
	useEffect(() => {
		const { nodes: newNodes, edges: newEdges } = buildGraphFromProgress(
			progress ?? null,
			history,
		);
		setNodes(newNodes);
		setEdges(newEdges);
	}, [progress, history, setNodes, setEdges]);

	const minimapNodeColor = useCallback((node: Node) => {
		const data = node.data as InvestigationNodeData;
		const colors = {
			pending: chartColors.node.default,
			running: chartColors.node.active,
			completed: chartColors.node.success,
			skipped: chartColors.node.idle,
			failed: chartColors.node.error,
		};
		return colors[data.status] || chartColors.node.default;
	}, []);

	if (isLoading && !progress) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base font-medium flex items-center gap-2">
						<PlayCircle className="h-4 w-4" />
						Investigation Graph
					</CardTitle>
					{progress && (
						<div className="flex items-center gap-2">
							<Badge variant="outline">{progress.phase}</Badge>
							<Badge
								variant={
									progress.status === "completed"
										? "default"
										: progress.status === "failed"
											? "destructive"
											: "secondary"
								}
							>
								{progress.status}
							</Badge>
							{progress.confidence !== null && (
								<Badge variant="outline">{progress.confidence}% confidence</Badge>
							)}
						</div>
					)}
				</div>
				{progress && (
					<div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
						<span>{progress.findings} findings</span>
						<span>{progress.hypotheses} hypotheses</span>
						<span>{progress.gatherIterations} gather iterations</span>
					</div>
				)}
			</CardHeader>
			<CardContent className="p-0">
				<div style={{ height: typeof height === "number" ? `${height}px` : height }}>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						nodeTypes={nodeTypes}
						fitView
						fitViewOptions={{ padding: 0.2 }}
						attributionPosition="bottom-left"
						proOptions={{ hideAttribution: true }}
						nodesDraggable={false}
						nodesConnectable={false}
					>
						<Background color={chartColors.muted} gap={16} />
						<Controls showInteractive={false} />
						<MiniMap nodeColor={minimapNodeColor} zoomable pannable />
					</ReactFlow>
				</div>
			</CardContent>
		</Card>
	);
}

export function InvestigationGraph(props: InvestigationGraphProps) {
	return (
		<ErrorBoundary>
			<ReactFlowProvider>
				<InvestigationGraphInner {...props} />
			</ReactFlowProvider>
		</ErrorBoundary>
	);
}

export default InvestigationGraph;
