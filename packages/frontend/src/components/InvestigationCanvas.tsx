"use client";

import React, { useCallback, useMemo } from "react";
import ReactFlow, {
	Background,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	MiniMap,
	type Node,
	type NodeProps,
	Position,
	useEdgesState,
	useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import {
	AlertCircle,
	Brain,
	CheckCircle,
	Lightbulb,
	Loader2,
	Search,
} from "lucide-react";

// Custom node types
const AlertNode = ({ data }: NodeProps) => {
	return (
		<div className="px-4 py-3 shadow-lg rounded-lg bg-red-50 border-2 border-red-300 min-w-[200px]">
			<Handle type="target" position={Position.Top} className="w-3 h-3" />
			<div className="flex items-center">
				<AlertCircle className="w-5 h-5 text-red-500 mr-2" />
				<div className="font-bold text-red-700">Alert Agent</div>
			</div>
			<div className="text-sm text-red-600 mt-1">{data.label}</div>
			{data.status === "completed" && (
				<CheckCircle className="w-4 h-4 text-green-500 absolute top-2 right-2" />
			)}
			{data.status === "running" && (
				<Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute top-2 right-2" />
			)}
			<Handle type="source" position={Position.Bottom} className="w-3 h-3" />
		</div>
	);
};

const GathererNode = ({ data }: NodeProps) => {
	return (
		<div className="px-4 py-3 shadow-lg rounded-lg bg-blue-50 border-2 border-blue-300 min-w-[200px]">
			<Handle type="target" position={Position.Top} className="w-3 h-3" />
			<div className="flex items-center">
				<Search className="w-5 h-5 text-blue-500 mr-2" />
				<div className="font-bold text-blue-700">Gatherer Agent</div>
			</div>
			<div className="text-sm text-blue-600 mt-1">{data.label}</div>
			{data.status === "completed" && (
				<CheckCircle className="w-4 h-4 text-green-500 absolute top-2 right-2" />
			)}
			{data.status === "running" && (
				<Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute top-2 right-2" />
			)}
			<Handle type="source" position={Position.Bottom} className="w-3 h-3" />
		</div>
	);
};

const AnalyzerNode = ({ data }: NodeProps) => {
	return (
		<div className="px-4 py-3 shadow-lg rounded-lg bg-purple-50 border-2 border-purple-300 min-w-[200px]">
			<Handle type="target" position={Position.Top} className="w-3 h-3" />
			<div className="flex items-center">
				<Brain className="w-5 h-5 text-purple-500 mr-2" />
				<div className="font-bold text-purple-700">Analyzer Agent</div>
			</div>
			<div className="text-sm text-purple-600 mt-1">{data.label}</div>
			{data.confidence && (
				<div className="text-xs text-purple-500 mt-1">
					Confidence: {(data.confidence * 100).toFixed(0)}%
				</div>
			)}
			{data.status === "completed" && (
				<CheckCircle className="w-4 h-4 text-green-500 absolute top-2 right-2" />
			)}
			{data.status === "running" && (
				<Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute top-2 right-2" />
			)}
			<Handle type="source" position={Position.Bottom} className="w-3 h-3" />
		</div>
	);
};

const RecommenderNode = ({ data }: NodeProps) => {
	return (
		<div className="px-4 py-3 shadow-lg rounded-lg bg-green-50 border-2 border-green-300 min-w-[200px]">
			<Handle type="target" position={Position.Top} className="w-3 h-3" />
			<div className="flex items-center">
				<Lightbulb className="w-5 h-5 text-green-500 mr-2" />
				<div className="font-bold text-green-700">Recommender Agent</div>
			</div>
			<div className="text-sm text-green-600 mt-1">{data.label}</div>
			{data.recommendations && (
				<div className="text-xs text-green-500 mt-1">
					{data.recommendations} recommendations
				</div>
			)}
			{data.status === "completed" && (
				<CheckCircle className="w-4 h-4 text-green-500 absolute top-2 right-2" />
			)}
			{data.status === "running" && (
				<Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute top-2 right-2" />
			)}
			<Handle type="source" position={Position.Bottom} className="w-3 h-3" />
		</div>
	);
};

const nodeTypes = {
	alert: AlertNode,
	gatherer: GathererNode,
	analyzer: AnalyzerNode,
	recommender: RecommenderNode,
};

interface InvestigationCanvasProps {
	investigationId: string;
	data?: {
		alertData?: any;
		gathererData?: any;
		analyzerData?: any;
		recommenderData?: any;
		status?: string;
	};
}

export default function InvestigationCanvas({
	investigationId,
	data,
}: InvestigationCanvasProps) {
	const initialNodes: Node[] = useMemo(
		() => [
			{
				id: "alert",
				type: "alert",
				position: { x: 250, y: 0 },
				data: {
					label: data?.alertData?.service || "Validating alert...",
					status: data?.alertData ? "completed" : "pending",
				},
			},
			{
				id: "gatherer",
				type: "gatherer",
				position: { x: 250, y: 120 },
				data: {
					label: data?.gathererData
						? "Context collected"
						: "Collecting context...",
					status: data?.gathererData
						? "completed"
						: data?.alertData
							? "running"
							: "pending",
				},
			},
			{
				id: "analyzer",
				type: "analyzer",
				position: { x: 250, y: 240 },
				data: {
					label: data?.analyzerData?.rootCause || "Analyzing root cause...",
					status: data?.analyzerData
						? "completed"
						: data?.gathererData
							? "running"
							: "pending",
					confidence: data?.analyzerData?.confidence,
				},
			},
			{
				id: "recommender",
				type: "recommender",
				position: { x: 250, y: 360 },
				data: {
					label: data?.recommenderData
						? "Recommendations ready"
						: "Generating recommendations...",
					status: data?.recommenderData
						? "completed"
						: data?.analyzerData
							? "running"
							: "pending",
					recommendations: data?.recommenderData?.count,
				},
			},
		],
		[data],
	);

	const initialEdges: Edge[] = useMemo(
		() => [
			{
				id: "e-alert-gatherer",
				source: "alert",
				target: "gatherer",
				animated: !data?.gathererData,
				markerEnd: { type: MarkerType.ArrowClosed },
			},
			{
				id: "e-gatherer-analyzer",
				source: "gatherer",
				target: "analyzer",
				animated: data?.gathererData && !data?.analyzerData,
				markerEnd: { type: MarkerType.ArrowClosed },
			},
			{
				id: "e-analyzer-recommender",
				source: "analyzer",
				target: "recommender",
				animated: data?.analyzerData && !data?.recommenderData,
				markerEnd: { type: MarkerType.ArrowClosed },
			},
		],
		[data],
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

	return (
		<div className="w-full h-[500px] bg-slate-100 dark:bg-slate-800 rounded-lg">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				nodeTypes={nodeTypes}
				fitView
				attributionPosition="bottom-left"
			>
				<Background color="#94a3b8" gap={16} />
				<Controls />
				<MiniMap
					nodeColor={(node) => {
						switch (node.type) {
							case "alert":
								return "#fecaca";
							case "gatherer":
								return "#bfdbfe";
							case "analyzer":
								return "#e9d5ff";
							case "recommender":
								return "#bbf7d0";
							default:
								return "#e2e8f0";
						}
					}}
				/>
			</ReactFlow>
		</div>
	);
}
