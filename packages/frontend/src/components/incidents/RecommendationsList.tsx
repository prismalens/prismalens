/**
 * Recommendations List Component
 *
 * Shows AI-generated recommendations for the incident
 */

import type { RecommendationWithRelations } from "@prismalens/contracts";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle, Clock, Lightbulb, Play, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface RecommendationsListProps {
	recommendations: RecommendationWithRelations[];
	onComplete?: (id: string) => void;
	onDismiss?: (id: string) => void;
}

const priorityColors: Record<string, string> = {
	critical: "bg-red-600 text-white",
	high: "bg-orange-500 text-white",
	medium: "bg-yellow-500 text-black",
	low: "bg-blue-500 text-white",
};

const categoryLabels: Record<string, string> = {
	immediate_action: "Immediate Action",
	investigation: "Investigation",
	remediation: "Remediation",
	prevention: "Prevention",
	monitoring: "Monitoring",
};

const statusConfig: Record<string, { icon: React.ReactNode; label: string }> = {
	pending: { icon: <Clock className="h-4 w-4" />, label: "Pending" },
	in_progress: { icon: <Play className="h-4 w-4" />, label: "In Progress" },
	completed: { icon: <CheckCircle className="h-4 w-4" />, label: "Completed" },
	rejected: { icon: <XCircle className="h-4 w-4" />, label: "Rejected" },
	deferred: { icon: <Clock className="h-4 w-4" />, label: "Deferred" },
};

export function RecommendationsList({
	recommendations,
	onComplete,
	onDismiss,
}: RecommendationsListProps) {
	if (recommendations.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
					<Lightbulb className="h-12 w-12 mb-4 opacity-50" />
					<p className="text-lg font-medium">No recommendations yet</p>
					<p className="text-sm">
						AI recommendations will appear here after an investigation completes
					</p>
				</CardContent>
			</Card>
		);
	}

	const pendingCount = recommendations.filter(
		(r) => r.status === "pending",
	).length;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="text-sm text-muted-foreground">
					{recommendations.length} recommendation
					{recommendations.length !== 1 ? "s" : ""}
					{pendingCount > 0 && ` (${pendingCount} pending)`}
				</div>
			</div>

			<div className="grid gap-3">
				{recommendations.map((rec) => {
					const status = statusConfig[rec.status] || statusConfig.pending;
					const isPending = rec.status === "pending";
					const isActionable = rec.actionable && isPending;

					return (
						<Card key={rec.id} className={isPending ? "border-primary/50" : ""}>
							<CardHeader className="pb-2">
								<div className="flex items-start justify-between gap-4">
									<div className="space-y-1">
										<CardTitle className="text-base font-medium flex items-center gap-2">
											<Lightbulb className="h-4 w-4 text-yellow-500" />
											{rec.title}
										</CardTitle>
										{rec.description && (
											<p className="text-sm text-muted-foreground">
												{rec.description}
											</p>
										)}
									</div>
									<div className="flex flex-col items-end gap-1">
										<Badge
											className={priorityColors[rec.priority] || "bg-gray-500"}
										>
											{rec.priority.charAt(0).toUpperCase() +
												rec.priority.slice(1)}
										</Badge>
										{rec.category && (
											<Badge variant="outline" className="text-xs">
												{categoryLabels[rec.category] || rec.category}
											</Badge>
										)}
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-4 text-sm text-muted-foreground">
										<span className="flex items-center gap-1">
											{status.icon}
											{status.label}
										</span>
										{rec.estimatedEffort && (
											<span>Effort: {rec.estimatedEffort}</span>
										)}
										{rec.urgency && (
											<Badge variant="secondary" className="text-xs">
												{rec.urgency}
											</Badge>
										)}
										<span>
											{formatDistanceToNow(new Date(rec.createdAt), {
												addSuffix: true,
											})}
										</span>
									</div>
									{isActionable && (
										<div className="flex items-center gap-2">
											{onDismiss && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => onDismiss(rec.id)}
												>
													<XCircle className="h-4 w-4 mr-1" />
													Dismiss
												</Button>
											)}
											{onComplete && (
												<Button
													variant="outline"
													size="sm"
													onClick={() => onComplete(rec.id)}
												>
													<CheckCircle className="h-4 w-4 mr-1" />
													Mark Complete
												</Button>
											)}
										</div>
									)}
								</div>
								{rec.implementedAt && rec.implementedBy && (
									<div className="mt-2 text-xs text-muted-foreground">
										Implemented by {rec.implementedBy} on{" "}
										{new Date(rec.implementedAt).toLocaleDateString()}
									</div>
								)}
							</CardContent>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
