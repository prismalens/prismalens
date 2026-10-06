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
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { backTarget, inIncident, useBack } from "@/hooks/use-back";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatClock } from "@/lib/format-time";
import { shortAge } from "@/lib/incident-board";
import { incidentStatusTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";

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

	const service = incident.service
		? incident.service.displayName || incident.service.name
		: null;
	const status =
		INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ?? incident.status;
	const items = [
		{
			key: "investigate",
			label: "Investigate again",
			disabled: investigateBlocked,
			reason: investigateDisabled ? investigateDisabledReason : undefined,
			onSelect: onInvestigate,
			testId: "band-menu-investigate",
		},
		...(resolved
			? [
					{
						key: "edit-cause",
						label: "Edit cause",
						disabled: false,
						reason: undefined,
						onSelect: onEditCause,
						testId: "band-menu-edit-cause",
					},
				]
			: []),
	];
	// A menu of one is a text button (look ruling L56); the phone keeps the menu for room.
	const single = items.length === 1 && !refired ? items[0] : null;

	return (
		<div
			className="bg-surface-1 [view-transition-name:band]"
			data-testid="incident-state-band"
		>
			<div
				// On desktop the band is the window's title strip (#752): it drags the window,
				// its controls opt out, and it clears the window controls and a folded sidebar's head.
				className="flex h-11 items-center gap-2.5 pr-3 pl-2 sm:h-10 desktop:app-drag desktop:pr-36 desktop:sm:h-(--titlebar-h) desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag desktop:[[data-sidebar-folded]_&]:pl-48 mac:pr-3 mac:[[data-sidebar-folded]_&]:pl-64"
			>
				<Hint label="Back" keys={["Esc"]}>
					<Button variant="text" size="icon" className="shrink-0" asChild>
						<a
							href={backHref}
							onClick={(e) => {
								e.preventDefault();
								back();
							}}
							aria-label={
								backHref === "/incidents" ? "Back to the board" : "Back"
							}
							data-testid="incident-back"
						>
							<ChevronLeft className="size-4" />
						</a>
					</Button>
				</Hint>
				<Mono className="shrink-0 text-meta text-text-3">
					INC-{incident.number}
				</Mono>
				<span
					role="img"
					aria-label={SEVERITY_LABEL[incident.severity]}
					className="size-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${incident.severity})` }}
				/>
				<Hint label={incident.title}>
					<h1 className="min-w-0 flex-1 truncate text-title">
						{incident.title}
					</h1>
				</Hint>
				<StateWord
					tone={incidentStatusTone(incident.status)}
					className="shrink-0 text-body max-md:hidden"
					data-testid="band-status"
				>
					{status}
				</StateWord>
				<span className="shrink-0 text-meta text-text-3 tabular-nums max-md:hidden">
					{shortAge(incident.triggeredAt, now)}
				</span>

				<div className="flex shrink-0 items-center gap-1">
					{primary && (
						<Button
							variant="primary"
							onClick={handlers[primary]}
							data-testid={`band-${primary === "close" ? "resolve" : primary}`}
							data-action={primary}
						>
							{INCIDENT_ACTION_LABEL[primary]}
						</Button>
					)}
					{single && (
						<Hint label={single.reason ?? ""} when={!!single.reason}>
							<span className="max-md:hidden">
								<Button
									variant="text"
									disabled={single.disabled}
									onClick={single.onSelect}
									data-testid={single.testId}
								>
									{single.label}
								</Button>
							</span>
						</Hint>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="text"
								size="icon"
								className={cn(single && "md:hidden")}
								aria-label="More actions"
								data-testid="band-more"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-[200px]">
							{items.map((item) => (
								<DropdownMenuItem
									key={item.key}
									disabled={item.disabled}
									onClick={item.onSelect}
									data-testid={single ? undefined : item.testId}
								>
									{item.label}
								</DropdownMenuItem>
							))}
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
			<p
				className="flex min-w-0 items-center gap-2.5 overflow-hidden px-4 pb-2 text-meta whitespace-nowrap text-text-3 md:hidden"
				data-testid="band-facts"
			>
				<StateWord tone={incidentStatusTone(incident.status)}>
					{status}
				</StateWord>
				<span className="tabular-nums">
					{shortAge(incident.triggeredAt, now)}
				</span>
				<span>{SEVERITY_LABEL[incident.severity]}</span>
				{service && <span className="truncate">{service}</span>}
			</p>
		</div>
	);
}
