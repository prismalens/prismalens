/**
 * Investigation Card Component
 *
 * Collapsible card showing investigation summary with embedded mini canvas.
 * Used in the InvestigationProgress component to display multiple investigations.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronRight,
	Clock,
	ExternalLink,
} from "lucide-react";
import type { Investigation, WorkflowStatus } from "@prismalens/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import InvestigationCanvas from "@/components/InvestigationCanvas";

export interface InvestigationCardProps {
	investigation: Investigation & {
		agentExecutions?: Array<{
			id: string;
			agentName: string;
			status: string;
			startedAt: string | null;
			completedAt: string | null;
			executionTimeMs: number | null;
			inputTokens: number | null;
			outputTokens: number | null;
			error: string | null;
			toolExecutions?: Array<{
				id: string;
				toolName: string;
				status: string;
				startedAt: string | null;
				completedAt: string | null;
				executionTimeMs: number | null;
				arguments: string | null;
				result: string | null;
				error: string | null;
			}>;
		}>;
	};
	defaultOpen?: boolean;
	showCanvas?: boolean;
}

function getStatusVariant(
	status: string
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "completed":
			return "default";
		case "running":
			return "secondary";
		case "failed":
			return "destructive";
		default:
			return "outline";
	}
}

function getStatusLabel(status: string): string {
	switch (status) {
		case "completed":
			return "Completed";
		case "running":
			return "Running";
		case "failed":
			return "Failed";
		case "pending":
			return "Pending";
		default:
			return status;
	}
}

function formatDuration(ms: number | null): string {
	if (!ms) return "-";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.round((ms % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function formatDate(dateStr: string | null): string {
	if (!dateStr) return "-";
	return new Date(dateStr).toLocaleString();
}

export function InvestigationCard({
	investigation,
	defaultOpen = false,
	showCanvas = true,
}: InvestigationCardProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const navigate = useNavigate();

	const handleViewFull = () => {
		navigate({
			to: "/investigations/$id",
			params: { id: investigation.id },
		});
	};

	// Calculate total duration
	const totalDuration = investigation.agentExecutions?.reduce(
		(sum, exec) => sum + (exec.executionTimeMs ?? 0),
		0
	);

	// Get tool count
	const toolCount =
		investigation.agentExecutions?.reduce(
			(sum, exec) => sum + (exec.toolExecutions?.length ?? 0),
			0
		) ?? 0;

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<div className="border rounded-lg bg-card">
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
					>
						<div className="flex items-center gap-3">
							{isOpen ? (
								<ChevronDown className="h-4 w-4 text-muted-foreground" />
							) : (
								<ChevronRight className="h-4 w-4 text-muted-foreground" />
							)}
							<div className="text-left">
								<div className="flex items-center gap-2">
									<span className="font-medium">
										Investigation #{investigation.id.slice(0, 8)}
									</span>
									<Badge variant={getStatusVariant(investigation.status)}>
										{getStatusLabel(investigation.status)}
									</Badge>
								</div>
								<div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
									<span className="flex items-center gap-1">
										<Clock className="h-3 w-3" />
										{formatDuration(totalDuration ?? null)}
									</span>
									<span>{toolCount} tools executed</span>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">
								{formatDate(investigation.createdAt)}
							</span>
						</div>
					</button>
				</CollapsibleTrigger>

				<CollapsibleContent>
					<div className="border-t px-4 py-4 space-y-4">
						{/* Summary and Root Cause */}
						{investigation.summary && (
							<div>
								<h4 className="text-sm font-medium mb-1">Summary</h4>
								<p className="text-sm text-muted-foreground">
									{investigation.summary}
								</p>
							</div>
						)}

						{investigation.rootCause && (
							<div>
								<h4 className="text-sm font-medium mb-1">Root Cause</h4>
								<p className="text-sm text-muted-foreground">
									{investigation.rootCause}
								</p>
							</div>
						)}

						{/* Mini Canvas */}
						{showCanvas && investigation.agentExecutions && (
							<div>
								<h4 className="text-sm font-medium mb-2">Execution Flow</h4>
								<InvestigationCanvas
									agentExecutions={investigation.agentExecutions as never}
									status={investigation.status as WorkflowStatus}
									investigationId={investigation.id}
									variant="mini"
									onViewFull={handleViewFull}
								/>
							</div>
						)}

						{/* View Full Button */}
						<div className="flex justify-end">
							<Button variant="outline" size="sm" onClick={handleViewFull}>
								<ExternalLink className="h-4 w-4 mr-2" />
								View Full Investigation
							</Button>
						</div>
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}
