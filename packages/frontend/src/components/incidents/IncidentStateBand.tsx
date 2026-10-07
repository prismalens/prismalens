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
import { ChevronLeft, MoreHorizontal, Plus } from "lucide-react";
import { useMemo } from "react";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { backTarget, inIncident, useBack } from "@/hooks/use-back";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatClock } from "@/lib/format-time";
import { shortAge } from "@/lib/incident-board";

export interface IncidentStateBandProps {
	incident: IncidentWithRelations;
	onAcknowledge: () => void;
	onNewRun: () => void;
	/** The operator's Resolve (stored `close`). */
	onClose: () => void;
	onReopen: () => void;
	onEditCause: () => void;
}

/**
 * The band (#673): id, severity, title, service, status and age on the left;
 * one primary (Acknowledge, Resolve or Reopen) and the menu on the right.
 * The run lives in the sidebar and under the box, never here (w18).
 */
export function IncidentStateBand({
	incident,
	onAcknowledge,
	onNewRun,
	onClose,
	onReopen,
	onEditCause,
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
	const service = incident.service;
	const status =
		INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ?? incident.status;

	return (
		<div
			data-testid="incident-state-band"
			className="flex h-(--header-h) min-w-0 shrink-0 items-center gap-2.5 pr-3 pl-2 [view-transition-name:band] desktop:app-drag desktop:pr-36 desktop:h-(--titlebar-h) desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag desktop:[[data-sidebar-folded]_&]:pl-48 mac:pr-3 mac:[[data-sidebar-folded]_&]:pl-64"
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
			<Hint label={SEVERITY_LABEL[incident.severity]}>
				<span
					role="img"
					aria-label={SEVERITY_LABEL[incident.severity]}
					className="size-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${incident.severity})` }}
				/>
			</Hint>
			<Hint label={incident.title}>
				<h1 className="min-w-12 truncate text-title">{incident.title}</h1>
			</Hint>
			{service && (
				<Link
					to="/services/$id"
					params={{ id: service.id }}
					className="shrink-0 text-body text-text-2 hover:text-text-1 max-md:hidden"
					data-testid="band-service"
				>
					{service.displayName || service.name}
				</Link>
			)}
			<div className="ml-auto flex shrink-0 items-center gap-2.5">
				<span
					className="text-body text-text-2 max-md:hidden"
					data-testid="band-status"
				>
					{status}
				</span>
				<span className="text-meta text-text-3 tabular-nums max-md:hidden">
					{shortAge(incident.triggeredAt, now)}
				</span>
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
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="text"
							size="icon"
							aria-label="More actions"
							data-testid="band-more"
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-[200px]">
						<DropdownMenuItem
							onClick={onNewRun}
							data-testid="band-menu-new-run"
						>
							<Plus className="size-3.5" />
							New run
						</DropdownMenuItem>
						{(resolved || refired) && <DropdownMenuSeparator />}
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
