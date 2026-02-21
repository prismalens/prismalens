/**
 * Start/End Node Component
 *
 * Terminal nodes for the investigation canvas graph
 */

import { Handle, type NodeProps, Position } from "reactflow";
import { cn } from "@/lib/utils";

export interface StartEndNodeData {
	label: string;
	status: "completed" | "failed" | "pending";
}

export function StartEndNode({ data }: NodeProps<StartEndNodeData>) {
	const isStart = data.label === "START";
	const isFailed = data.status === "failed";

	return (
		<div
			className={cn(
				"px-6 py-2 rounded-full border-2 shadow-sm",
				"min-w-[80px] text-center font-medium text-sm",
				isFailed
					? "bg-red-100 border-red-400 text-red-700 dark:bg-red-950 dark:border-red-600 dark:text-red-300"
					: "bg-zinc-100 border-zinc-400 text-zinc-700 dark:bg-zinc-800 dark:border-zinc-600 dark:text-zinc-300",
			)}
		>
			{!isStart && (
				<Handle
					type="target"
					position={Position.Top}
					className="w-2 h-2 !bg-zinc-400"
				/>
			)}
			{data.label}
			{isStart && (
				<Handle
					type="source"
					position={Position.Bottom}
					className="w-2 h-2 !bg-zinc-400"
				/>
			)}
		</div>
	);
}
