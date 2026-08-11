// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, WorkflowStatus } from "@prismalens/contracts";
import { Brain } from "lucide-react";
import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentStyle, transformLiveEventsToCanvas } from "@/lib/canvas";
import { InvestigationStatusBadge } from "./investigation.utils";

interface AgentExecutionsTabProps {
	events: CanonicalEvent[];
	status: WorkflowStatus;
}

/**
 * Per-agent-node summary, from the canonical event stream (live or replayed
 * — #417). No duration/token metrics or per-tool breakdown: that granularity
 * only ever existed on the retired AgentExecution/ToolExecution rows, which
 * real investigations never populated.
 */
export function AgentExecutionsTab({
	events,
	status,
}: AgentExecutionsTabProps) {
	const agentNodes = useMemo(
		() =>
			transformLiveEventsToCanvas(events, status).nodes.filter(
				(node) => node.type === "agent",
			),
		[events, status],
	);

	if (agentNodes.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<Brain className="h-12 w-12 mb-4 opacity-50 text-muted-foreground" />
					<p className="text-lg font-medium text-muted-foreground">
						No agent executions yet
					</p>
					<p className="text-sm text-muted-foreground">
						Agent executions will appear here as the investigation progresses
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{agentNodes.map((node) => {
				const agentStyle = getAgentStyle(
					node.data.agentName ?? node.data.label,
				);
				return (
					<Card key={node.id} className="border-l-4 border-l-gray-500">
						<CardHeader className="pb-2">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<Brain className="h-5 w-5 text-gray-500" />
									<div>
										<CardTitle className="text-base">
											{agentStyle.displayName}
										</CardTitle>
										{node.data.agentName && (
											<p className="text-xs text-muted-foreground">
												{node.data.agentName}
											</p>
										)}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<InvestigationStatusBadge status={node.data.status} />
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<span className="text-muted-foreground">Tools Used</span>
									<p className="font-medium">{node.data.toolCount ?? 0}</p>
								</div>
							</div>

							{/* Error display */}
							{node.data.error && (
								<div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20">
									<p className="text-sm text-destructive font-medium">Error</p>
									<p className="text-sm text-destructive/80">
										{node.data.error}
									</p>
								</div>
							)}
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}
