// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TRIGGER_ICON } from "@/components/shell/ThreadList";
import { useNow } from "@/hooks/use-now";
import { orpc } from "@/lib/api/orpc-client";
import { scheduleWhen } from "@/lib/format-time";
import { readableTitle } from "@/lib/title";
import { TRIGGER_WORD, triggerOf } from "@/lib/trigger";
import { firingWord } from "./run-labels";

/** Labels worth a glance; the rest stay on the alert's page. */
const SHOWN = 4;

/**
 * The first node of a thread the world started (#1020, events principle 4):
 * its trigger, source, labels and how long it has fired, with a way to the
 * event itself. Every trigger kind uses this one card.
 */
export function TriggerCard({ incident }: { incident: IncidentWithRelations }) {
	const now = useNow(30_000);
	const { kind, source } = triggerOf(incident);
	const alert = incident.alerts?.[0];
	if (kind === "you" || !alert) return null;
	const Icon = TRIGGER_ICON[kind];
	const firing = firingWord(incident.alerts ?? [], now);
	const labels = Object.entries(alert.labels ?? {}).slice(0, SHOWN);
	return (
		<li
			className="flex flex-col gap-1.5 rounded-surface bg-surface-1 px-3.5 py-3"
			data-testid="trigger-card"
			data-kind={kind}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-text-2">
				<Icon aria-hidden className="size-3.5 shrink-0 stroke-[1.75]" />
				<span>{TRIGGER_WORD[kind]}</span>
				{source && <span className="text-text-3">{source}</span>}
				{firing && (
					<span
						className={firing.firing ? "text-danger" : "text-text-3"}
						data-testid="trigger-firing"
					>
						{firing.text}
					</span>
				)}
				<Link
					to="/alerts/$id"
					params={{ id: alert.id }}
					className="ml-auto inline-flex min-h-6 items-center text-accent hover:underline"
					data-testid="trigger-open"
				>
					Open
				</Link>
			</div>
			<p className="min-w-0 truncate text-body font-medium text-text-1">
				{readableTitle(alert.title)}
			</p>
			{labels.length > 0 && (
				// The raw labels are diagnostics; a phone keeps the alert's name and state above them.
				<p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-meta text-text-3 max-sm:hidden">
					{labels.map(([k, v]) => (
						<span key={k} className="min-w-0 break-all">
							{k}={v}
						</span>
					))}
				</p>
			)}
		</li>
	);
}

const RAN = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

/** The same first node for a run a schedule started: which schedule, how often, when it ran. */
export function ScheduleTriggerCard({
	scheduleId,
	ranAt,
}: {
	scheduleId: string;
	ranAt: string | null;
}) {
	const { data } = useQuery(
		orpc.schedules.get.queryOptions({ input: { id: scheduleId } }),
	);
	const schedule = data?.schedule;
	const Icon = TRIGGER_ICON.schedule;
	return (
		<div
			className="flex flex-col gap-1.5 rounded-surface bg-surface-1 px-3.5 py-3"
			data-testid="trigger-card"
			data-kind="schedule"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-text-2">
				<Icon aria-hidden className="size-3.5 shrink-0 stroke-[1.75]" />
				<span>{TRIGGER_WORD.schedule}</span>
				{schedule && (
					<span className="text-text-3">{scheduleWhen(schedule)}</span>
				)}
				{ranAt && (
					<span className="text-text-3" data-testid="trigger-ran">
						ran {RAN.format(new Date(ranAt))}
					</span>
				)}
			</div>
			{/* The page's Back already goes to this schedule, so the card links nowhere. */}
			<p className="min-w-0 truncate text-body font-medium text-text-1">
				{schedule?.name ?? "Scheduled run"}
			</p>
		</div>
	);
}
