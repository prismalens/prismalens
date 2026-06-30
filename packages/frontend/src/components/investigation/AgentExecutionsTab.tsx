import { formatDistanceToNow } from "date-fns";
import { Brain } from "lucide-react";
import type { AgentExecutionWithTools } from "@prismalens/contracts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvestigationStatusBadge } from "./investigation.utils";

interface AgentExecutionsTabProps {
	agentExecutions: AgentExecutionWithTools[];
}

export function AgentExecutionsTab({ agentExecutions }: AgentExecutionsTabProps) {
	if (agentExecutions.length === 0) {
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
			{agentExecutions.map((agent) => (
				<Card
					key={agent.id}
					className="border-l-4 border-l-gray-500"
				>
					<CardHeader className="pb-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<Brain className="h-5 w-5 text-gray-500" />
								<div>
									<CardTitle className="text-base capitalize">
										{agent.agentName.replace(/_/g, " ")}
									</CardTitle>
									<p className="text-xs text-muted-foreground">
										{agent.agentType}
									</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<InvestigationStatusBadge status={agent.status} />
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
							<div>
								<span className="text-muted-foreground">Started</span>
								<p className="font-medium">
									{agent.startedAt
										? formatDistanceToNow(new Date(agent.startedAt), {
												addSuffix: true,
											})
										: "-"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Duration</span>
								<p className="font-medium">
									{agent.executionTimeMs
										? `${(agent.executionTimeMs / 1000).toFixed(1)}s`
										: "-"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Tokens</span>
								<p className="font-medium">
									{agent.inputTokens || agent.outputTokens
										? `${agent.inputTokens ?? 0} / ${agent.outputTokens ?? 0}`
										: "-"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Tools Used</span>
								<p className="font-medium">
									{agent.toolExecutions?.length ?? 0}
								</p>
							</div>
						</div>

						{/* Tool Executions */}
						{agent.toolExecutions && agent.toolExecutions.length > 0 && (
							<div className="mt-4 pt-4 border-t">
								<p className="text-sm font-medium mb-2">Tool Executions</p>
								<div className="space-y-2">
									{agent.toolExecutions.map((tool) => (
										<div
											key={tool.id}
											className="flex items-center justify-between p-2 rounded bg-muted text-sm"
										>
											<div className="flex items-center gap-2">
												<Badge variant="outline" className="font-mono text-xs">
													{tool.toolName}
												</Badge>
												{tool.toolCategory && (
													<span className="text-muted-foreground text-xs">
														{tool.toolCategory}
													</span>
												)}
											</div>
											<div className="flex items-center gap-2">
												{tool.executionTimeMs && (
													<span className="text-xs text-muted-foreground">
														{tool.executionTimeMs}ms
													</span>
												)}
												<InvestigationStatusBadge status={tool.status} />
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Error display */}
						{agent.error && (
							<div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20">
								<p className="text-sm text-destructive font-medium">Error</p>
								<p className="text-sm text-destructive/80">{agent.error}</p>
							</div>
						)}
					</CardContent>
				</Card>
			))}
		</div>
	);
}
