// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isIncidentOpen } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { formatDateTime } from "@/lib/format-time";
import { useIncidentRecord } from "../record-context";
import { Card } from "./Card";

function formatDuration(ms: number | null): string {
	if (!ms) return "0m";
	const minutes = Math.floor(ms / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	return `${minutes}m`;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
			<dt className="shrink-0 text-meta text-muted-foreground">{label}</dt>
			<dd className="min-w-0 truncate text-right text-record">{children}</dd>
		</div>
	);
}

/**
 * The incident's own fields (#743 §3c.6): one line of facts, and a disclosure
 * for the rest, including the metrics slot the old telemetry surface held.
 */
export function DetailsCard() {
	const { incident } = useIncidentRecord();
	const [open, setOpen] = useState(false);
	const now = useNow();
	const openNow = isIncidentOpen(incident.status);
	const duration = openNow
		? now === null
			? null
			: now - new Date(incident.triggeredAt).getTime()
		: (incident.timeToClose ?? incident.timeToResolve);
	const service = incident.service
		? incident.service.displayName || incident.service.name
		: null;
	const assignee = incident.assignedTo
		? `${incident.assignedTo.firstName} ${incident.assignedTo.lastName}`
		: "Unassigned";

	return (
		<Card testId="details-card">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
				<span className="text-foreground">{service ?? "No service"}</span>
				<span className="tabular-nums">
					{incident.alertCount} alert{incident.alertCount === 1 ? "" : "s"}
				</span>
				<span>{assignee}</span>
				<span className="tabular-nums">
					{openNow
						? "Open"
						: incident.status === "closed"
							? "Resolved in"
							: "Alerts cleared in"}{" "}
					{formatDuration(duration)}
				</span>
				<span>Metrics not connected</span>
				<Button
					variant="ghost"
					size="xs"
					className="ml-auto text-meta text-primary"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
					data-testid="details-toggle"
				>
					{open ? "Less" : "Details"}
				</Button>
			</div>
			{open && (
				<div data-testid="details-open">
					{incident.description && (
						<p className="mb-2 text-record text-muted-foreground">
							{incident.description}
						</p>
					)}
					<dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
						<Detail label="Triggered">
							<span className="tabular-nums">
								{formatDateTime(incident.triggeredAt)}
							</span>
						</Detail>
						{incident.acknowledgedAt && (
							<Detail label="Acknowledged">
								<span className="tabular-nums">
									{formatDateTime(incident.acknowledgedAt)}
								</span>
							</Detail>
						)}
						{incident.resolvedAt && (
							<Detail label="Alerts cleared">
								<span className="tabular-nums">
									{formatDateTime(incident.resolvedAt)}
								</span>
							</Detail>
						)}
						{incident.closedAt && (
							<Detail label="Resolved">
								<span className="tabular-nums">
									{formatDateTime(incident.closedAt)}
								</span>
							</Detail>
						)}
						{incident.timeToAcknowledge ? (
							<Detail label="Time to acknowledge">
								<span className="tabular-nums">
									{formatDuration(incident.timeToAcknowledge)}
								</span>
							</Detail>
						) : null}
						<Detail label="Service">
							{incident.service ? (
								<Link
									to="/services/$id"
									params={{ id: incident.service.id }}
									search={{ tab: "overview" }}
									className="text-primary hover:underline"
								>
									{service}
								</Link>
							) : (
								"None"
							)}
						</Detail>
						<Detail label="Assigned to">{assignee}</Detail>
						<Detail label="Metrics">
							<Link
								to="/settings"
								search={{ tab: "integrations" }}
								className="text-primary hover:underline"
							>
								Connect in Settings
							</Link>
						</Detail>
					</dl>
					{incident.tags && incident.tags.length > 0 && (
						<div className="mt-2 flex flex-wrap items-center gap-1">
							<span className="mr-1 text-meta text-muted-foreground">Tags</span>
							{incident.tags.map((tag) => (
								<StateChip key={tag} tone="neutral" mono>
									{tag}
								</StateChip>
							))}
						</div>
					)}
					{incident.affectedSystems && incident.affectedSystems.length > 0 && (
						<div className="mt-2 flex flex-wrap items-center gap-1">
							<span className="mr-1 text-meta text-muted-foreground">
								Affected systems
							</span>
							{incident.affectedSystems.map((system) => (
								<StateChip key={system} tone="neutral" mono dashed>
									{system}
								</StateChip>
							))}
						</div>
					)}
					{incident.customerImpact && (
						<div className="mt-2">
							<p className="text-meta text-muted-foreground">Customer impact</p>
							<p className="text-record">{incident.customerImpact}</p>
						</div>
					)}
					{incident.correlationReason && (
						<div className="mt-2">
							<p className="text-meta text-muted-foreground">
								Why these alerts are one incident
							</p>
							<p className="text-record">{incident.correlationReason}</p>
						</div>
					)}
				</div>
			)}
		</Card>
	);
}
