// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BAND_ACTIONS,
	canIncidentAction,
	INCIDENT_ACTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentAction,
	type IncidentStatus,
	type IncidentWithRelations,
	REFIRE_LABEL,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { backTarget, inIncident, useBack } from "@/hooks/use-back";
import { ago, useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatClock } from "@/lib/format-time";
import { incidentStatusTone } from "@/lib/state-tone";

export interface IncidentStateBandProps {
	incident: IncidentWithRelations;
	/** A run is in flight: Investigate again is withheld; Stop lives on the run strip. */
	runLive: boolean;
	onAcknowledge: () => void;
	onInvestigate: () => void;
	/** The operator's Resolve (stored `close`). */
	onClose: () => void;
	onReopen: () => void;
	onEditCause: () => void;
	isInvestigating?: boolean;
	investigateDisabled?: boolean;
	investigateDisabledReason?: string;
}

/**
 * The state band: one row that never wraps. Where you are (id, severity,
 * title, status, age) on the left; the one lifecycle action and a menu on the
 * right (R1a d7). The primary is the first of Acknowledge, Resolve, Reopen the
 * status admits, the same on every tab, and never Investigate; the run's state
 * lives on the run strip under it.
 */
export function IncidentStateBand({
	incident,
	runLive,
	onAcknowledge,
	onInvestigate,
	onClose,
	onReopen,
	onEditCause,
	isInvestigating,
	investigateDisabled,
	investigateDisabledReason,
}: IncidentStateBandProps) {
	usePageTitle(`INC-${incident.number} ${incident.title}`);
	const now = useNow();
	const leaf = useMemo(() => inIncident(incident.id), [incident.id]);
	const back = useBack(leaf, "/incidents");
	const backHref = backTarget(leaf, "/incidents");
	const handlers: Partial<Record<IncidentAction, () => void>> = {
		acknowledge: onAcknowledge,
		close: onClose,
		reopen: onReopen,
	};
	const primary = BAND_ACTIONS.find((a) =>
		canIncidentAction(a, incident.status),
	);
	const resolved = incident.status === "closed";
	const refired = incident.refiredAs;
	const investigateBlocked = runLive || investigateDisabled || isInvestigating;

	return (
		<div
			data-testid="incident-state-band"
			// On desktop the band is the window's title strip (#752): it drags the window,
			// its controls opt out, and it clears the window controls and a folded sidebar's head.
			className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-3 py-1.5 [view-transition-name:band] sm:h-10 sm:flex-nowrap sm:overflow-hidden sm:py-0 desktop:app-drag desktop:pr-36 desktop:sm:h-(--titlebar-h) desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag desktop:[[data-sidebar-folded]_&]:pl-48 mac:pr-3 mac:[[data-sidebar-folded]_&]:pl-64"
		>
			<Button variant="ghost" size="icon" className="shrink-0" asChild>
				<a
					href={backHref}
					onClick={(e) => {
						e.preventDefault();
						back();
					}}
					aria-label={backHref === "/incidents" ? "Back to the board" : "Back"}
					title="Back"
					data-testid="incident-back"
				>
					<ChevronLeft className="size-4" />
				</a>
			</Button>
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
					<Button
						size="sm"
						className="h-7"
						onClick={handlers[primary]}
						data-testid={`band-${primary === "close" ? "resolve" : primary}`}
						data-action={primary}
					>
						{INCIDENT_ACTION_LABEL[primary]}
					</Button>
				)}
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
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuItem
							disabled={investigateBlocked}
							onClick={onInvestigate}
							title={
								investigateDisabled ? investigateDisabledReason : undefined
							}
							data-testid="band-menu-investigate"
						>
							Investigate again
						</DropdownMenuItem>
						{resolved && (
							<DropdownMenuItem
								onClick={onEditCause}
								data-testid="band-menu-edit-cause"
							>
								Edit cause
							</DropdownMenuItem>
						)}
						{refired && (
							<DropdownMenuItem asChild data-testid="band-menu-refired">
								<Link to="/incidents/$id" params={{ id: refired.id }}>
									{REFIRE_LABEL} as INC-{refired.number},{" "}
									{formatClock(refired.createdAt)}
								</Link>
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
