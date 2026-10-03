// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	isAlertFiring,
	isIncidentOpen,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useNow } from "@/hooks/use-now";
import { useServiceIntegrations } from "@/lib/api/hooks";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { type Fact, RecordLink } from "./RecordLayout";
import { runElapsed, useRunAgentModel } from "./RunStrip";
import { useIncidentRecord } from "./record-context";

function plural(n: number, one: string) {
	return `${n} ${one}${n === 1 ? "" : "s"}`;
}

function openFor(ms: number): string {
	const m = Math.max(0, Math.floor(ms / 60_000));
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}

/** The telemetry a run on this incident's service may query: names of the sources that are on. */
export function useTelemetryNames(serviceId: string | null | undefined) {
	const { data = [], isSuccess } = useServiceIntegrations(serviceId ?? "");
	if (!serviceId || !isSuccess) return null;
	return data
		.filter(
			(i) =>
				i.category === "observability" &&
				// On unless this service turned it off (ServiceTelemetrySection's rule).
				(!i.hasOverride ||
					(i.serviceConfig as { enabled?: boolean } | null)?.enabled !== false),
		)
		.map((i) => i.connectionName);
}

/** Whether a run worked with no repository, from the entry it wrote at start. */
export function useRanWithoutRepo(investigationId: string | null): boolean {
	const { timeline } = useIncidentRecord();
	if (!investigationId) return false;
	return timeline.some(
		(e) =>
			e.metadata?.investigationId === investigationId &&
			e.metadata?.mapped === false,
	);
}

/** The selected run in a few words: `OpenCode, done in 1m 15s`. */
export function useRunFact(): string {
	const { run, investigationId } = useIncidentRecord();
	const now = useNow(1000);
	const who = useRunAgentModel(run.investigation);
	const inv = run.investigation;
	if (!investigationId) return "None yet";
	if (!inv || !run.state) return "Loading";
	const took = formatElapsed(runElapsed(inv, now));
	switch (run.state) {
		case "starting":
		case "working":
		case "stopping":
			return `${who.agent}, working ${took}`;
		case "done":
			return `${who.agent}, done in ${took}`;
		case "failed":
			return `${who.agent}, failed after ${took}`;
		case "stopped":
			return `${who.agent}, stopped by you${inv.completedAt ? ` at ${formatClock(inv.completedAt)}` : ""}`;
	}
}

/** The access level the run had, from its report; a run before the report ran at the default. */
export function useAccessFact(): string {
	const { run } = useIncidentRecord();
	return ACCESS_LABEL[run.investigation?.report?.fidelity?.mode ?? "read-only"];
}

/**
 * The incident's facts (study-v3 §3.3): Status, Severity, Service, Alerts,
 * Run, Access, Telemetry, Links in the rail; the same, shorter, as the
 * details line below 1280.
 */
export function useIncidentFacts(): { rail: Fact[]; line: ReactNode[] } {
	const { incident, investigationId } = useIncidentRecord();
	const now = useNow();
	const runFact = useRunFact();
	const access = useAccessFact();
	const telemetry = useTelemetryNames(incident.service?.id);
	const service = incident.service
		? incident.service.displayName || incident.service.name
		: null;
	const alerts = incident.alerts ?? [];
	const firing = alerts.filter((a) => isAlertFiring(a.status));
	const since = firing.length
		? Math.min(...firing.map((a) => Date.parse(a.triggeredAt)))
		: null;
	const alertFact =
		alerts.length === 0
			? "None"
			: since !== null
				? `${firing.length} firing since ${formatClock(since)}`
				: `${alerts.length}, none firing`;
	const open = isIncidentOpen(incident.status);
	const age =
		open && now !== null
			? `open ${openFor(now - Date.parse(incident.triggeredAt))}`
			: null;

	const rail: Fact[] = [
		{
			label: "Status",
			value:
				INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ??
				incident.status,
		},
		{ label: "Severity", value: SEVERITY_LABEL[incident.severity] },
		{
			label: "Service",
			value: incident.service ? (
				<Link
					to="/services/$id"
					params={{ id: incident.service.id }}
					className="hover:text-accent"
				>
					{service}
				</Link>
			) : (
				"None"
			),
		},
		{ label: "Alerts", value: alertFact },
		{ label: "Run", value: runFact, testId: "fact-run" },
		{ label: "Access", value: access, testId: "fact-access" },
	];
	if (telemetry)
		rail.push({
			label: "Telemetry",
			value: telemetry.length ? telemetry.join(", ") : "None linked",
			testId: "fact-telemetry",
		});
	if (investigationId)
		rail.push({
			label: "Links",
			value: (
				<>
					<RecordLink incidentId={incident.id} to="conversation">
						Conversation
					</RecordLink>
					<RecordLink
						incidentId={incident.id}
						to="conversation"
						search={{ ledger: "1" }}
					>
						Event log
					</RecordLink>
				</>
			),
		});

	const line: ReactNode[] = [
		service ?? "No service",
		plural(alerts.length, "alert"),
		...(age ? [age] : []),
		...(telemetry?.length ? [telemetry.join(", ")] : []),
	];
	return { rail, line };
}
