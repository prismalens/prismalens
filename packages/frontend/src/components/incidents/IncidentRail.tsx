// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isIncidentOpen,
	WORKFLOW_STATUS_LABEL,
	type WorkflowStatus,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	FidelityBadge,
	SimilarIncidentRow,
} from "@/components/investigation/ReportSections";
import type { InvestigationRun } from "@/components/investigation/useInvestigationRun";
import { LiveSlot } from "@/components/shared/LiveSlot";
import { Mono } from "@/components/shared/Mono";
import { StateChip } from "@/components/shared/StateChip";
import { formatDateTime } from "@/lib/format-time";
import { runStatusTone } from "@/lib/state-tone";

interface RailBlockProps {
	title: string;
	aside?: ReactNode;
	children: ReactNode;
	testId?: string;
}

function RailBlock({ title, aside, children, testId }: RailBlockProps) {
	return (
		<section className="rounded-md border p-3" data-testid={testId}>
			<div className="mb-2 flex items-center justify-between gap-2">
				<h2 className="text-record font-medium">{title}</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1">
			<dt className="shrink-0 text-meta text-muted-foreground">{label}</dt>
			<dd className="min-w-0 truncate text-right text-record">{children}</dd>
		</div>
	);
}

function formatDuration(ms: number | null): string {
	if (!ms) return "—";
	const minutes = Math.floor(ms / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	return `${minutes}m`;
}

/** What the run is doing now, or what it did: the first block of the Run surface. */
export function RunBlock({ run }: { run: InvestigationRun | null }) {
	const investigation = run?.investigation ?? null;
	if (!investigation) {
		return (
			<p className="rounded-md border border-dashed p-3 text-record text-muted-foreground">
				No run yet. Investigate from the band, or type /investigate in the
				composer.
			</p>
		);
	}
	return (
		<>
			{run?.isActive && investigation && (
				<RailBlock
					title="Working now"
					testId="rail-working-now"
					aside={
						<StateChip tone="active" pulse>
							live
						</StateChip>
					}
				>
					<p className="text-record">
						{run.latestText ?? "Waiting for the first step"}
					</p>
					<p className="mt-1 text-meta text-muted-foreground tabular-nums">
						{run.events.length} events · {run.ledgerStatus}
					</p>
				</RailBlock>
			)}

			{investigation && !run?.isActive && (
				<RailBlock
					title="Run summary"
					testId="rail-run-summary"
					aside={
						investigation.report?.fidelity ? (
							<FidelityBadge fidelity={investigation.report.fidelity} />
						) : undefined
					}
				>
					<dl>
						<Detail label="Status">
							<StateChip tone={runStatusTone(investigation.status)}>
								{WORKFLOW_STATUS_LABEL[
									investigation.status as WorkflowStatus
								] ?? investigation.status}
							</StateChip>
						</Detail>
						<Detail label="Started">
							<span className="tabular-nums">
								{investigation.startedAt
									? formatDateTime(investigation.startedAt)
									: "—"}
							</span>
						</Detail>
						<Detail label="Completed">
							<span className="tabular-nums">
								{investigation.completedAt
									? formatDateTime(investigation.completedAt)
									: "—"}
							</span>
						</Detail>
						<Detail label="Events">
							<span className="tabular-nums">{run?.events.length ?? 0}</span>
						</Detail>
						<Detail label="Origin">
							<Mono>{investigation.origin}</Mono>
						</Detail>
					</dl>
				</RailBlock>
			)}
		</>
	);
}

/** Past incidents the reduce step ranked as similar, with their recorded cause. */
export function SimilarBlock({ run }: { run: InvestigationRun | null }) {
	const similar = run?.investigation?.overlay?.similarIncidents ?? [];
	if (similar.length === 0) return null;
	return (
		<>
			{similar.length > 0 && (
				<RailBlock
					title="Similar past incidents"
					testId="rail-similar-incidents"
				>
					<ul className="divide-y">
						{similar.map((s) => (
							<SimilarIncidentRow key={s.incidentId} similar={s} />
						))}
					</ul>
				</RailBlock>
			)}
		</>
	);
}

/** The live slots: what is true now, as distinct from the run's captures. */
export function TelemetryBlock({
	incident,
}: {
	incident: IncidentWithRelations;
}) {
	return (
		<div className="space-y-2">
			<LiveSlot
				label={
					incident.service
						? `Metrics · ${incident.service.displayName || incident.service.name}`
						: "Metrics"
				}
				state="not-configured"
				reason="No metrics integration for this service yet."
				action={{
					label: "Connect one in Settings",
					to: "/settings?tab=integrations",
				}}
			/>
		</div>
	);
}

/** The incident's own fields. */
export function DetailsBlock({
	incident,
}: {
	incident: IncidentWithRelations;
}) {
	const isActive = isIncidentOpen(incident.status);
	const duration = isActive
		? Date.now() - new Date(incident.triggeredAt).getTime()
		: incident.timeToResolve;
	return (
		<>
			<RailBlock title="Details" testId="rail-details">
				<dl>
					<Detail label={isActive ? "Open for" : "Time to resolve"}>
						<span className="tabular-nums">{formatDuration(duration)}</span>
					</Detail>
					{incident.timeToAcknowledge ? (
						<Detail label="Time to acknowledge">
							<span className="tabular-nums">
								{formatDuration(incident.timeToAcknowledge)}
							</span>
						</Detail>
					) : null}
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
						<Detail label="Resolved">
							<span className="tabular-nums">
								{formatDateTime(incident.resolvedAt)}
							</span>
						</Detail>
					)}
					<Detail label="Alerts">
						<span className="tabular-nums">{incident.alertCount}</span>
					</Detail>
					<Detail label="Assigned to">
						{incident.assignedTo
							? `${incident.assignedTo.firstName} ${incident.assignedTo.lastName}`
							: "Unassigned"}
					</Detail>
					{incident.service && (
						<Detail label="Service">
							<Link
								to="/services/$id"
								params={{ id: incident.service.id }}
								search={{ tab: "overview" }}
								className="text-primary hover:underline"
							>
								{incident.service.displayName || incident.service.name}
							</Link>
						</Detail>
					)}
				</dl>
				{incident.tags && incident.tags.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1">
						{incident.tags.map((tag) => (
							<StateChip key={tag} tone="neutral" mono>
								{tag}
							</StateChip>
						))}
					</div>
				)}
				{incident.affectedSystems && incident.affectedSystems.length > 0 && (
					<div className="mt-3">
						<p className="text-meta text-muted-foreground">Affected systems</p>
						<div className="mt-1 flex flex-wrap gap-1">
							{incident.affectedSystems.map((system) => (
								<StateChip key={system} tone="neutral" mono dashed>
									{system}
								</StateChip>
							))}
						</div>
					</div>
				)}
				{incident.customerImpact && (
					<div className="mt-3">
						<p className="text-meta text-muted-foreground">Customer impact</p>
						<p className="text-record">{incident.customerImpact}</p>
					</div>
				)}
				{incident.correlationReason && (
					<div className="mt-3">
						<p className="text-meta text-muted-foreground">
							Why these alerts are one incident
						</p>
						<p className="text-record">{incident.correlationReason}</p>
					</div>
				)}
			</RailBlock>
		</>
	);
}
