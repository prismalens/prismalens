/**
 * Incident Detail Header Component
 *
 * Shows incident title, severity, status, and quick actions
 */

import type { IncidentWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle, Play, Search, XCircle } from "lucide-react";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export interface IncidentDetailHeaderProps {
	incident: IncidentWithRelations;
	onAcknowledge?: () => void;
	onInvestigate?: () => void;
	onResolve?: () => void;
	isInvestigating?: boolean;
	investigateDisabled?: boolean;
	investigateDisabledReason?: string;
}

const priorityColors: Record<string, string> = {
	p1: "bg-red-600 text-white",
	p2: "bg-orange-500 text-white",
	p3: "bg-yellow-500 text-black",
	p4: "bg-blue-500 text-white",
	p5: "bg-gray-500 text-white",
};

export function IncidentDetailHeader({
	incident,
	onAcknowledge,
	onInvestigate,
	onResolve,
	isInvestigating,
	investigateDisabled,
	investigateDisabledReason,
}: IncidentDetailHeaderProps) {
	const canAcknowledge = incident.status === "triggered";
	const canInvestigate = ["triggered", "investigating"].includes(
		incident.status,
	);
	const canResolve = !["resolved", "closed"].includes(incident.status);

	return (
		<div className="space-y-4">
			{/* Back link */}
			<Link
				to="/incidents"
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to Incidents
			</Link>

			{/* Header Row */}
			<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					{/* Number and Title */}
					<div className="flex items-center gap-3">
						<span className="font-mono text-lg text-muted-foreground">
							INC-{incident.number}
						</span>
						<h1 className="text-2xl font-bold">{incident.title}</h1>
					</div>

					{/* Badges */}
					<div className="flex flex-wrap items-center gap-2">
						<SeverityBadge severity={incident.severity} />
						<Badge
							className={priorityColors[incident.priority] || "bg-gray-500"}
						>
							{incident.priority.toUpperCase()}
						</Badge>
						<StatusBadge status={incident.status} />
						{incident.service && (
							<Link
								to="/services/$id"
								params={{ id: incident.service.id }}
								search={{ tab: "overview" }}
								className="text-sm text-primary hover:underline"
							>
								{incident.service.displayName || incident.service.name}
							</Link>
						)}
					</div>

					{/* Description */}
					{incident.description && (
						<p className="text-muted-foreground max-w-2xl">
							{incident.description}
						</p>
					)}

					{/* Meta info */}
					<div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
						<span>
							Triggered: {new Date(incident.triggeredAt).toLocaleString()}
						</span>
						{incident.acknowledgedAt && (
							<span>
								Acknowledged:{" "}
								{new Date(incident.acknowledgedAt).toLocaleString()}
							</span>
						)}
						{incident.resolvedAt && (
							<span>
								Resolved: {new Date(incident.resolvedAt).toLocaleString()}
							</span>
						)}
						<span>{incident.alertCount} alert(s)</span>
					</div>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2">
					{canAcknowledge && onAcknowledge && (
						<Button variant="outline" onClick={onAcknowledge}>
							<CheckCircle className="h-4 w-4 mr-2" />
							Acknowledge
						</Button>
					)}
					{canInvestigate && onInvestigate && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<span>
										<Button
											onClick={onInvestigate}
											disabled={isInvestigating || investigateDisabled}
										>
											{isInvestigating ? (
												<>
													<Play className="h-4 w-4 mr-2 animate-pulse" />
													Starting...
												</>
											) : (
												<>
													<Search className="h-4 w-4 mr-2" />
													Investigate
												</>
											)}
										</Button>
									</span>
								</TooltipTrigger>
								{investigateDisabled && investigateDisabledReason && (
									<TooltipContent>
										<p>{investigateDisabledReason}</p>
									</TooltipContent>
								)}
							</Tooltip>
						</TooltipProvider>
					)}
					{canResolve && onResolve && (
						<Button variant="outline" onClick={onResolve}>
							<XCircle className="h-4 w-4 mr-2" />
							Resolve
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
