// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canIncidentAction,
	INCIDENT_STATUS_LABEL,
	type IncidentAction,
	type IncidentStatus,
	type IncidentWithRelations,
	isIncidentOpen,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
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
	/** A run is in flight: Investigate is withheld; Stop lives on the run strip. */
	runLive: boolean;
	onAcknowledge: () => void;
	onInvestigate: () => void;
	onResolve: () => void;
	onClose: () => void;
	onReopen: () => void;
	isInvestigating?: boolean;
	investigateDisabled?: boolean;
	investigateDisabledReason?: string;
	/** On a route under the incident the phone's back goes to the incident, not the list. */
	backToIncident?: boolean;
	/** The tab has the box, whose own button starts an investigation. */
	hideInvestigate?: boolean;
}

const ACTION_LABEL: Record<IncidentAction, string> = {
	acknowledge: "Acknowledge",
	investigate: "Investigate",
	resolve: "Resolve",
	close: "Close",
	reopen: "Reopen",
};

/**
 * The state band: one row that never wraps. Where you are (id, severity,
 * title, status, age) on the left; one primary action and a menu for the rest
 * on the right. The run's state lives on the run strip under it (#743 §2).
 */
export function IncidentStateBand({
	incident,
	runLive,
	onAcknowledge,
	onInvestigate,
	onResolve,
	onClose,
	onReopen,
	isInvestigating,
	investigateDisabled,
	investigateDisabledReason,
	backToIncident,
	hideInvestigate,
}: IncidentStateBandProps) {
	usePageTitle(`INC-${incident.number} ${incident.title}`);
	const now = useNow();
	const handlers: Record<IncidentAction, () => void> = {
		acknowledge: onAcknowledge,
		investigate: onInvestigate,
		resolve: onResolve,
		close: onClose,
		reopen: onReopen,
	};
	// The one the status admits first, in the order the incident moves through.
	// Once resolved, closing is the next step; Investigate stays in the menu (#743).
	const order: IncidentAction[] = isIncidentOpen(incident.status)
		? ["investigate", "acknowledge", "resolve", "close"]
		: ["close", "reopen", "investigate"];
	const admitted = order.filter(
		(a) =>
			canIncidentAction(a, incident.status) &&
			!(a === "investigate" && (runLive || hideInvestigate)),
	);
	const primary = admitted[0];
	const rest = admitted.slice(1);
	const primaryBlocked = primary === "investigate" && investigateDisabled;

	return (
		<div
			data-testid="incident-state-band"
			// On desktop the band is the window's title strip (#752): it drags the window,
			// its controls opt out, and it clears the window controls and a folded sidebar's head.
			className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-3 py-1.5 [view-transition-name:band] sm:h-10 sm:flex-nowrap sm:overflow-hidden sm:py-0 desktop:app-drag desktop:pr-36 desktop:sm:h-(--titlebar-h) desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag desktop:[[data-sidebar-folded]_&]:pl-48 mac:pr-3 mac:[[data-sidebar-folded]_&]:pl-64"
		>
			{backToIncident ? (
				<Link
					to="/incidents/$id"
					params={{ id: incident.id }}
					search={true}
					aria-label={`Back to INC-${incident.number}`}
					title="Back to Overview  Esc"
					className="inline-flex h-7 shrink-0 items-center rounded pr-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<ChevronLeft className="h-4 w-4" />
				</Link>
			) : (
				<Link
					to="/incidents"
					aria-label="Back to the board"
					title="Back to the board  Esc"
					className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<ChevronLeft className="h-4 w-4" />
				</Link>
			)}
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
				title="Incident status"
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
				{rest.length > 0 && (
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
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</div>
	);
}
