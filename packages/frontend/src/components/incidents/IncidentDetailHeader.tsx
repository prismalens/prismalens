// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incident Detail Header Component
 *
 * Shows incident title, severity, status, and quick actions
 */

import type { IncidentWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	Archive,
	ArrowLeft,
	CheckCircle,
	Play,
	Search,
	XCircle,
} from "lucide-react";
import { Mono } from "@/components/shared/Mono";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { type ChipTone, StateChip } from "@/components/shared/StateChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
	onClose?: () => void;
	isInvestigating?: boolean;
	investigateDisabled?: boolean;
	investigateDisabledReason?: string;
}

const priorityTone: Record<string, ChipTone> = {
	p1: "critical",
	p2: "high",
	p3: "medium",
	p4: "low",
	p5: "neutral",
};

export function IncidentDetailHeader({
	incident,
	onAcknowledge,
	onInvestigate,
	onResolve,
	onClose,
	isInvestigating,
	investigateDisabled,
	investigateDisabledReason,
}: IncidentDetailHeaderProps) {
	const canAcknowledge = incident.status === "triggered";
	const canInvestigate = ["triggered", "investigating"].includes(
		incident.status,
	);
	const canResolve = !["resolved", "closed"].includes(incident.status);
	const canClose = incident.status === "resolved";

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
						<Mono className="text-lg text-muted-foreground">
							INC-{incident.number}
						</Mono>
						<h1 className="text-2xl font-bold">{incident.title}</h1>
					</div>

					{/* Badges */}
					<div className="flex flex-wrap items-center gap-2">
						<SeverityBadge severity={incident.severity} />
						<StateChip tone={priorityTone[incident.priority] || "neutral"}>
							{incident.priority.toUpperCase()}
						</StateChip>
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

					{/*
					 * Either field alone is a valid close record — the dialog allows a
					 * category with no prose — and similarity ranking uses the category
					 * whether or not a description came with it. Showing only the
					 * combined form hid what a responder had recorded (#667 review).
					 */}
					{(incident.actualCause || incident.actualCauseCategory) && (
						<p className="max-w-2xl text-sm">
							<span className="text-muted-foreground">
								{incident.actualCause
									? `Actual cause${
											incident.actualCauseCategory
												? ` (${incident.actualCauseCategory})`
												: ""
										}: `
									: "Actual cause category: "}
							</span>
							{incident.actualCause ?? incident.actualCauseCategory}
						</p>
					)}

					{/* Meta info */}
					<div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
						<span>
							Triggered:{" "}
							<Mono>{new Date(incident.triggeredAt).toLocaleString()}</Mono>
						</span>
						{incident.acknowledgedAt && (
							<span>
								Acknowledged:{" "}
								<Mono>
									{new Date(incident.acknowledgedAt).toLocaleString()}
								</Mono>
							</span>
						)}
						{incident.resolvedAt && (
							<span>
								Resolved:{" "}
								<Mono>{new Date(incident.resolvedAt).toLocaleString()}</Mono>
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
					{canClose && onClose && (
						<Button variant="outline" onClick={onClose}>
							<Archive className="h-4 w-4 mr-2" />
							Close
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
