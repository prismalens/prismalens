"use client";

/**
 * Node Details Panel
 *
 * Side panel showing detailed information about a selected agent node.
 * Includes execution metrics, token usage, and tool executions.
 */

import type { AgentExecutionWithTools, ToolExecution } from "@prismalens/contracts";
import {
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Clock,
	Cpu,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import type { Node } from "reactflow";

import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
	formatExecutionTime,
	formatTokenCount,
	getAgentStyle,
} from "@/lib/canvas";
import { StatusIndicator } from "./StatusIndicator";

export interface NodeDetailsPanelProps {
	node: Node | null;
	onClose: () => void;
}

export function NodeDetailsPanel({ node, onClose }: NodeDetailsPanelProps) {
	const execution = node?.data?.execution as AgentExecutionWithTools | undefined;
	const isOpen = !!node && !!execution;

	if (!execution) {
		return (
			<Sheet open={isOpen} onOpenChange={() => onClose()}>
				<SheetContent className="w-[400px] sm:w-[540px]">
					<SheetHeader>
						<SheetTitle>No Details Available</SheetTitle>
					</SheetHeader>
				</SheetContent>
			</Sheet>
		);
	}

	const style = getAgentStyle(execution.agentName);
	const toolCount = execution.toolExecutions?.length ?? 0;

	return (
		<Sheet open={isOpen} onOpenChange={() => onClose()}>
			<SheetContent className="w-[400px] sm:w-[540px] p-0">
				<SheetHeader className="px-6 pt-6 pb-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<StatusIndicator status={execution.status} size="lg" />
							<div>
								<SheetTitle className={style.textColor}>
									{style.displayName}
								</SheetTitle>
								<SheetDescription className="text-xs font-mono">
									{execution.agentType}
								</SheetDescription>
							</div>
						</div>
					</div>
				</SheetHeader>

				<Separator />

				<ScrollArea className="h-[calc(100vh-140px)]">
					<div className="px-6 py-4 space-y-6">
						{/* Execution Metrics */}
						<section>
							<h4 className="text-sm font-medium mb-3">Execution Metrics</h4>
							<div className="grid grid-cols-2 gap-4">
								<MetricCard
									icon={<Clock className="h-4 w-4" />}
									label="Duration"
									value={formatExecutionTime(execution.executionTimeMs)}
								/>
								<MetricCard
									icon={<Cpu className="h-4 w-4" />}
									label="Tokens"
									value={formatTokenCount(
										execution.inputTokens,
										execution.outputTokens,
									)}
								/>
							</div>
						</section>

						{/* Timestamps */}
						<section>
							<h4 className="text-sm font-medium mb-3">Timeline</h4>
							<div className="space-y-2 text-sm">
								{execution.startedAt && (
									<div className="flex justify-between">
										<span className="text-muted-foreground">Started</span>
										<span>{new Date(execution.startedAt).toLocaleString()}</span>
									</div>
								)}
								{execution.completedAt && (
									<div className="flex justify-between">
										<span className="text-muted-foreground">Completed</span>
										<span>{new Date(execution.completedAt).toLocaleString()}</span>
									</div>
								)}
							</div>
						</section>

						{/* Error */}
						{execution.error && (
							<section>
								<h4 className="text-sm font-medium mb-3 text-destructive">
									Error
								</h4>
								<div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
									<p className="text-sm text-destructive">{execution.error}</p>
								</div>
							</section>
						)}

						{/* Tool Executions */}
						{toolCount > 0 && (
							<section>
								<h4 className="text-sm font-medium mb-3">
									Tool Executions ({toolCount})
								</h4>
								<div className="space-y-2">
									{execution.toolExecutions?.map((tool) => (
										<ToolExecutionItem key={tool.id} tool={tool} />
									))}
								</div>
							</section>
						)}
					</div>
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

function MetricCard({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="p-3 bg-muted rounded-lg">
			<div className="flex items-center gap-2 text-muted-foreground mb-1">
				{icon}
				<span className="text-xs">{label}</span>
			</div>
			<p className="font-medium">{value}</p>
		</div>
	);
}

function ToolExecutionItem({ tool }: { tool: ToolExecution }) {
	const [isOpen, setIsOpen] = useState(false);

	const statusIcon =
		tool.status === "success" ? (
			<CheckCircle className="h-3 w-3 text-green-500" />
		) : tool.status === "error" ? (
			<XCircle className="h-3 w-3 text-red-500" />
		) : (
			<Clock className="h-3 w-3 text-amber-500" />
		);

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className={cn(
						"w-full flex items-center justify-between p-2 rounded-lg",
						"bg-muted hover:bg-muted/80 transition-colors",
						"text-left text-sm",
					)}
				>
					<div className="flex items-center gap-2">
						{isOpen ? (
							<ChevronDown className="h-4 w-4 text-muted-foreground" />
						) : (
							<ChevronRight className="h-4 w-4 text-muted-foreground" />
						)}
						<span className="font-mono text-xs">{tool.toolName}</span>
						{tool.toolCategory && (
							<Badge variant="outline" className="text-xs px-1.5 py-0">
								{tool.toolCategory}
							</Badge>
						)}
					</div>
					<div className="flex items-center gap-2">
						{tool.executionTimeMs && (
							<span className="text-xs text-muted-foreground">
								{tool.executionTimeMs}ms
							</span>
						)}
						{statusIcon}
					</div>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="mt-1 ml-6 p-2 bg-zinc-50 dark:bg-zinc-900 rounded text-xs">
					{tool.error && (
						<div className="mb-2 text-destructive">
							<strong>Error:</strong> {tool.error}
						</div>
					)}
					{tool.arguments && Object.keys(tool.arguments).length > 0 && (
						<div className="mb-2">
							<strong className="text-muted-foreground">Arguments:</strong>
							<pre className="mt-1 p-2 bg-zinc-100 dark:bg-zinc-800 rounded overflow-x-auto">
								{JSON.stringify(tool.arguments, null, 2)}
							</pre>
						</div>
					)}
					{tool.result && Object.keys(tool.result).length > 0 && (
						<div>
							<strong className="text-muted-foreground">Result:</strong>
							<pre className="mt-1 p-2 bg-zinc-100 dark:bg-zinc-800 rounded overflow-x-auto max-h-[200px]">
								{JSON.stringify(tool.result, null, 2)}
							</pre>
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
