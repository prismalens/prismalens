/**
 * Investigation Progress Component
 *
 * Shows the status of AI investigations for the incident
 */

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Brain, CheckCircle, Clock, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

// Investigation reference type (from incident relations)
interface InvestigationRef {
	id: string;
	status: string;
	createdAt: string;
	completedAt: string | null;
}

export interface InvestigationProgressProps {
	investigations: InvestigationRef[];
	onStartInvestigation?: () => void;
	isStarting?: boolean;
}

const statusConfig: Record<
	string,
	{ label: string; icon: React.ReactNode; color: string }
> = {
	pending: {
		label: "Pending",
		icon: <Clock className="h-4 w-4" />,
		color: "bg-gray-500",
	},
	running: {
		label: "Running",
		icon: <Loader2 className="h-4 w-4 animate-spin" />,
		color: "bg-blue-500",
	},
	completed: {
		label: "Completed",
		icon: <CheckCircle className="h-4 w-4" />,
		color: "bg-green-500",
	},
	failed: {
		label: "Failed",
		icon: <XCircle className="h-4 w-4" />,
		color: "bg-red-500",
	},
};

function getProgressValue(status: string): number {
	switch (status) {
		case "pending":
			return 0;
		case "running":
			return 50;
		case "completed":
			return 100;
		case "failed":
			return 100;
		default:
			return 0;
	}
}

export function InvestigationProgress({
	investigations,
	onStartInvestigation,
	isStarting,
}: InvestigationProgressProps) {
	const hasRunningInvestigation = investigations.some(
		(inv) => inv.status === "running",
	);

	if (investigations.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<Brain className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
					<p className="text-lg font-medium mb-2">No investigations yet</p>
					<p className="text-sm text-muted-foreground mb-4">
						Start an AI-powered investigation to analyze this incident
					</p>
					{onStartInvestigation && (
						<Button onClick={onStartInvestigation} disabled={isStarting}>
							{isStarting ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Starting...
								</>
							) : (
								<>
									<Brain className="h-4 w-4 mr-2" />
									Start Investigation
								</>
							)}
						</Button>
					)}
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="text-sm text-muted-foreground">
					{investigations.length} investigation
					{investigations.length !== 1 ? "s" : ""}
				</div>
				{onStartInvestigation && !hasRunningInvestigation && (
					<Button
						variant="outline"
						size="sm"
						onClick={onStartInvestigation}
						disabled={isStarting}
					>
						{isStarting ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Starting...
							</>
						) : (
							<>
								<Brain className="h-4 w-4 mr-2" />
								New Investigation
							</>
						)}
					</Button>
				)}
			</div>

			<div className="grid gap-3">
				{investigations.map((investigation) => {
					const config =
						statusConfig[investigation.status] || statusConfig.pending;
					const progress = getProgressValue(investigation.status);

					return (
						<Card key={investigation.id}>
							<CardHeader className="pb-2">
								<div className="flex items-center justify-between">
									<CardTitle className="text-base font-medium flex items-center gap-2">
										<Brain className="h-4 w-4" />
										AI Investigation
									</CardTitle>
									<Badge className={`${config.color} text-white`}>
										<span className="flex items-center gap-1">
											{config.icon}
											{config.label}
										</span>
									</Badge>
								</div>
							</CardHeader>
							<CardContent className="space-y-3">
								<Progress value={progress} className="h-2" />

								<div className="flex items-center justify-between text-sm">
									<div className="text-muted-foreground">
										Started{" "}
										{formatDistanceToNow(new Date(investigation.createdAt), {
											addSuffix: true,
										})}
									</div>
									{investigation.completedAt && (
										<div className="text-muted-foreground">
											Completed{" "}
											{formatDistanceToNow(
												new Date(investigation.completedAt),
												{
													addSuffix: true,
												},
											)}
										</div>
									)}
								</div>

								<div className="flex justify-end">
									<Button variant="outline" size="sm" asChild>
										<Link
											to="/investigations/$id"
											params={{ id: investigation.id }}
										>
											View Details
										</Link>
									</Button>
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
