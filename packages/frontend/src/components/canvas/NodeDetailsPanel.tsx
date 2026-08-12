// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Node Details Panel
 *
 * Side panel showing detailed information about a selected agent node,
 * sourced from the canonical event stream (live or replayed — #417). The
 * stream carries per-node status, tool count and error, but not per-node
 * duration/token usage or full tool arguments/results — those only ever
 * existed on the retired AgentExecution/ToolExecution rows, which real
 * investigations never populated.
 */

import { Wrench } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { type CanvasNode, getAgentStyle } from "@/lib/canvas";
import { StatusIndicator } from "./StatusIndicator";

export interface NodeDetailsPanelProps {
	node: CanvasNode | null;
	onClose: () => void;
}

export function NodeDetailsPanel({ node, onClose }: NodeDetailsPanelProps) {
	const isOpen = !!node && node.type === "agent";
	const data = node?.data;

	if (!isOpen || !data) {
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

	const style = getAgentStyle(data.agentName ?? data.label);

	return (
		<Sheet open={isOpen} onOpenChange={() => onClose()}>
			<SheetContent className="w-[400px] sm:w-[540px] p-0">
				<SheetHeader className="px-6 pt-6 pb-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<StatusIndicator status={data.status} size="lg" />
							<div style={style.cssVars}>
								<SheetTitle className={style.textColor}>
									{style.displayName}
								</SheetTitle>
								{data.agentName && (
									<SheetDescription className="text-xs font-mono">
										{data.agentName}
									</SheetDescription>
								)}
							</div>
						</div>
					</div>
				</SheetHeader>

				<Separator />

				<div className="px-6 py-4 space-y-6">
					{/* Tool count */}
					<section>
						<h4 className="text-sm font-medium mb-3">Tools</h4>
						<div className="p-3 bg-muted rounded-lg">
							<div className="flex items-center gap-2 text-muted-foreground mb-1">
								<Wrench className="h-4 w-4" />
								<span className="text-xs">Tool calls</span>
							</div>
							<p className="font-medium">{data.toolCount ?? 0}</p>
						</div>
					</section>

					{/* Error */}
					{data.error && (
						<section>
							<h4 className="text-sm font-medium mb-3 text-destructive">
								Error
							</h4>
							<div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
								<p className="text-sm text-destructive">{data.error}</p>
							</div>
						</section>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
