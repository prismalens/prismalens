// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canIncidentAction,
	type IncidentWithRelations,
	isWorkflowLive,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	Archive,
	CheckCircle,
	ChevronLeft,
	Search,
	XCircle,
} from "lucide-react";
import { Mono } from "@/components/shared/Mono";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StateChip } from "@/components/shared/StateChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { ago, useNow } from "@/hooks/use-now";
import { priorityTone, runStatusTone } from "@/lib/state-tone";

export interface RunCapsule {
	/** 1-based index of the run among the incident's runs, newest first. */
	ordinal: number;
	status: string;
	branches: number;
	harness?: string;
	/** Elapsed for a live run; total duration for a finished one. */
	elapsed?: string;
	onCancel?: () => void;
	isCancelling?: boolean;
}

export interface IncidentStateBandProps {
	incident: IncidentWithRelations;
	run?: RunCapsule | null;
	onAcknowledge?: () => void;
	onInvestigate?: () => void;
	onResolve?: () => void;
	onClose?: () => void;
	isInvestigating?: boolean;
	investigateDisabled?: boolean;
	investigateDisabledReason?: string;
}

/**
 * The state band: identity, severity, status, age and the run capsule in one strip
 * that never scrolls away. Everything the operator needs to know *where they are*
 * lives here; everything they need to *read* lives in the record below.
 */
export function IncidentStateBand({
	incident,
	run,
	onAcknowledge,
	onInvestigate,
	onResolve,
	onClose,
	isInvestigating,
	investigateDisabled,
	investigateDisabledReason,
}: IncidentStateBandProps) {
	const now = useNow();
	const runLive = !!run && isWorkflowLive(run.status);
	const canAcknowledge = canIncidentAction("acknowledge", incident.status);
	const canInvestigate =
		canIncidentAction("investigate", incident.status) && !runLive;
	const canResolve = canIncidentAction("resolve", incident.status);
	const canClose = canIncidentAction("close", incident.status);

	return (
		<div
			data-testid="incident-state-band"
			className="border-b bg-background px-4 sm:px-6"
		>
			<div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-2">
				<Link
					to="/incidents"
					aria-label="Back to incidents"
					className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<ChevronLeft className="h-4 w-4" />
				</Link>

				<Mono className="rounded border px-1.5 py-0.5 text-record text-muted-foreground">
					INC-{incident.number}
				</Mono>
				<SeverityBadge severity={incident.severity} />

				<div className="min-w-0 flex-1 basis-72">
					<h1 className="line-clamp-2 text-base font-semibold leading-tight tracking-tight">
						{incident.title}
					</h1>
					<div className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground tabular-nums">
						<span>opened {ago(incident.triggeredAt, now)}</span>
						{incident.service && (
							<Link
								to="/services/$id"
								params={{ id: incident.service.id }}
								search={{ tab: "overview" }}
								className="text-primary hover:underline"
							>
								{incident.service.displayName || incident.service.name}
							</Link>
						)}
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge status={incident.status} />
					<StateChip tone={priorityTone(incident.priority)}>
						{incident.priority.toUpperCase()}
					</StateChip>
				</div>

				{run && (
					<div
						data-testid="run-capsule"
						className="flex items-center gap-2 rounded border border-(--chip)/35 bg-(--chip)/8 px-2 py-1 text-meta tabular-nums"
						style={
							{
								"--chip": `var(--run-${runLive ? "active" : run.status === "completed" ? "done" : "failed"})`,
							} as React.CSSProperties
						}
					>
						<StateChip tone={runStatusTone(run.status)} pulse={runLive}>
							Run #{run.ordinal}
						</StateChip>
						<span className="text-muted-foreground">{run.status}</span>
						{run.elapsed && (
							<span className="text-muted-foreground">· {run.elapsed}</span>
						)}
						{run.branches > 1 && (
							<span className="text-muted-foreground">
								· {run.branches} branches
							</span>
						)}
						{run.harness && (
							<span className="text-muted-foreground">· via {run.harness}</span>
						)}
						{runLive && run.onCancel && (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-meta text-run-failed hover:text-run-failed"
								onClick={run.onCancel}
								disabled={run.isCancelling}
							>
								<XCircle className="mr-1 h-3.5 w-3.5" />
								{run.isCancelling ? "Cancelling" : "Cancel"}
							</Button>
						)}
					</div>
				)}

				<div className="ml-auto flex items-center gap-2">
					{canAcknowledge && onAcknowledge && (
						<Button variant="outline" size="sm" onClick={onAcknowledge}>
							<CheckCircle className="mr-1.5 h-3.5 w-3.5" />
							Acknowledge
						</Button>
					)}
					{canInvestigate && onInvestigate && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<span data-testid="band-investigate-trigger">
										<Button
											size="sm"
											onClick={onInvestigate}
											disabled={isInvestigating || investigateDisabled}
											data-testid="band-investigate-button"
										>
											<Search className="mr-1.5 h-3.5 w-3.5" />
											{isInvestigating ? "Starting" : "Investigate"}
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
						<Button variant="outline" size="sm" onClick={onResolve}>
							<XCircle className="mr-1.5 h-3.5 w-3.5" />
							Resolve
						</Button>
					)}
					{canClose && onClose && (
						<Button variant="outline" size="sm" onClick={onClose}>
							<Archive className="mr-1.5 h-3.5 w-3.5" />
							Close
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
