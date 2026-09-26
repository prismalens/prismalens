// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canIncidentAction,
	INCIDENT_STATUS_LABEL,
	type IncidentAction,
	type IncidentStatus,
	type IncidentWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal, PanelRight } from "lucide-react";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { ago, useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { incidentStatusTone } from "@/lib/state-tone";

export interface IncidentStateBandProps {
	incident: IncidentWithRelations;
	/** A run is in flight: Investigate is withheld and Cancel is offered in the menu. */
	runLive: boolean;
	onAcknowledge: () => void;
	onInvestigate: () => void;
	onResolve: () => void;
	onClose: () => void;
	onCancelRun?: () => void;
	isInvestigating?: boolean;
	investigateDisabled?: boolean;
	investigateDisabledReason?: string;
	surfaceOpen: boolean;
	onToggleSurfaces: () => void;
}

const ACTION_LABEL: Record<IncidentAction, string> = {
	acknowledge: "Acknowledge",
	investigate: "Investigate",
	resolve: "Resolve",
	close: "Close",
};

/**
 * The state band: one row that never wraps. Where you are (id, severity,
 * title, status, age) on the left; one primary action and a menu for the rest
 * on the right. The run's state lives in the rail, not here.
 */
export function IncidentStateBand({
	incident,
	runLive,
	onAcknowledge,
	onInvestigate,
	onResolve,
	onClose,
	onCancelRun,
	isInvestigating,
	investigateDisabled,
	investigateDisabledReason,
	surfaceOpen,
	onToggleSurfaces,
}: IncidentStateBandProps) {
	usePageTitle(`INC-${incident.number} ${incident.title}`);
	const now = useNow();
	const handlers: Record<IncidentAction, () => void> = {
		acknowledge: onAcknowledge,
		investigate: onInvestigate,
		resolve: onResolve,
		close: onClose,
	};
	// The one the status admits first, in the order the incident moves through.
	const order: IncidentAction[] = [
		"investigate",
		"acknowledge",
		"resolve",
		"close",
	];
	const admitted = order.filter(
		(a) =>
			canIncidentAction(a, incident.status) &&
			!(a === "investigate" && runLive),
	);
	const primary = admitted[0];
	const rest = admitted.slice(1);
	const primaryBlocked = primary === "investigate" && investigateDisabled;

	return (
		<div
			data-testid="incident-state-band"
			className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-3 py-1.5 sm:h-10 sm:flex-nowrap sm:overflow-hidden sm:py-0"
		>
			<Link
				to="/incidents"
				aria-label="Back to incidents"
				className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
			>
				<ChevronLeft className="h-4 w-4" />
			</Link>
			<Mono className="shrink-0 text-meta text-muted-foreground">
				INC-{incident.number}
			</Mono>
			<span
				role="img"
				aria-label={SEVERITY_LABEL[incident.severity]}
				title={SEVERITY_LABEL[incident.severity]}
				className="h-2 w-2 shrink-0 rounded-full"
				style={{ background: `var(--sev-${incident.severity})` }}
			/>
			<h1
				className="order-last line-clamp-2 min-w-0 basis-full text-record font-semibold tracking-tight sm:order-none sm:line-clamp-none sm:flex-1 sm:basis-auto sm:truncate"
				title={incident.title}
			>
				{incident.title}
			</h1>
			<StateWord
				tone={incidentStatusTone(incident.status)}
				className="shrink-0"
				data-testid="band-status"
			>
				{INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ??
					incident.status}
			</StateWord>
			<span className="hidden shrink-0 text-meta text-muted-foreground tabular-nums sm:inline">
				{ago(incident.triggeredAt, now)}
			</span>

			<div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-1">
				{primary && (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<span data-testid="band-investigate-trigger">
									<Button
										size="sm"
										className="h-7"
										onClick={handlers[primary]}
										disabled={
											primaryBlocked ||
											(primary === "investigate" && isInvestigating)
										}
										data-testid={`band-${primary}`}
									>
										{primary === "investigate" && isInvestigating
											? "Starting"
											: ACTION_LABEL[primary]}
									</Button>
								</span>
							</TooltipTrigger>
							{primaryBlocked && investigateDisabledReason && (
								<TooltipContent>
									<p>{investigateDisabledReason}</p>
								</TooltipContent>
							)}
						</Tooltip>
					</TooltipProvider>
				)}
				{(rest.length > 0 || (runLive && onCancelRun)) && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 w-7 p-0"
								aria-label="More actions"
								data-testid="band-more"
							>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							{rest.map((a) => (
								<DropdownMenuItem
									key={a}
									onClick={handlers[a]}
									data-testid={`band-menu-${a}`}
								>
									{ACTION_LABEL[a]}
								</DropdownMenuItem>
							))}
							{runLive && onCancelRun && (
								<DropdownMenuItem
									onClick={onCancelRun}
									className="text-run-failed"
									data-testid="band-menu-cancel-run"
								>
									Cancel run
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="hidden h-7 w-7 p-0 xl:inline-flex"
					aria-label={surfaceOpen ? "Hide the side pane" : "Show the side pane"}
					aria-pressed={surfaceOpen}
					onClick={onToggleSurfaces}
					data-testid="band-rail-toggle"
				>
					<PanelRight className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}
