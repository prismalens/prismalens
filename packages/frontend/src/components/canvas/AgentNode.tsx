/**
 * Agent Node Component
 *
 * Represents an agent execution in the investigation canvas.
 * Shows agent name, status, execution time, and tool count.
 */

import type { ExecutionStatus } from "@prismalens/contracts";
import { Handle, type NodeProps, Position } from "reactflow";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	formatExecutionTime,
	getAgentStyle,
} from "@/lib/canvas/transform-executions";
import { StatusIndicator } from "./StatusIndicator";

export interface AgentNodeData {
	label: string;
	status: ExecutionStatus | "pending";
	agentName?: string;
	executionTimeMs?: number | null;
	toolCount?: number;
	error?: string | null;
}

export function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
	const style = getAgentStyle(data.agentName || "");
	const Icon = style.icon;

	return (
		<div
			className={cn(
				"px-4 py-3 shadow-lg rounded-lg border-2 min-w-[220px] relative",
				"transition-all duration-200",
				style.bg,
				style.border,
				selected && "ring-2 ring-blue-500 ring-offset-2",
			)}
		>
			<Handle
				type="target"
				position={Position.Top}
				className="w-3 h-3 !bg-zinc-400"
			/>

			{/* Header with icon and name */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Icon className={cn("w-5 h-5", style.iconColor)} />
					<span className={cn("font-semibold", style.textColor)}>
						{data.label}
					</span>
				</div>
				<StatusIndicator status={data.status} size="md" />
			</div>

			{/* Metadata row */}
			<div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
				{/* Execution time */}
				{data.status !== "pending" && (
					<span>{formatExecutionTime(data.executionTimeMs)}</span>
				)}

				{/* Tool count badge */}
				{data.toolCount !== undefined && data.toolCount > 0 && (
					<Badge variant="secondary" className="text-xs px-1.5 py-0">
						{data.toolCount} {data.toolCount === 1 ? "tool" : "tools"}
					</Badge>
				)}

			</div>

			{/* Error message (truncated) */}
			{data.error && (
				<div className="mt-2 text-xs text-red-600 dark:text-red-400 truncate max-w-[200px]">
					{data.error}
				</div>
			)}

			<Handle
				type="source"
				position={Position.Bottom}
				className="w-3 h-3 !bg-zinc-400"
			/>
		</div>
	);
}
