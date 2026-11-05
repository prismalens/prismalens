// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	isIncidentEnded,
	ROOT_CAUSE_CATEGORY_LABEL,
	SERVICE_TYPE_LABEL,
	type TopologyEdge,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { Fragment, useState } from "react";
import { firingOf } from "@/components/inbox/inbox-model";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { firingWord, viewName } from "@/components/run/run-labels";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useHarnesses } from "@/lib/api/hooks";
import { formatClock } from "@/lib/format-time";
import { attentionFor } from "@/lib/incident-attention";
import { incidentSummary } from "@/lib/incident-summary";
import { incidentServices } from "@/lib/service-lanes";
import { cn } from "@/lib/utils";
import {
	causeCategory,
	endedRun,
	type NextActionId,
	nextStrip,
	startsRun,
} from "./fixes";
import type { Overview } from "./use-overview";

const TONE_BG = {
	accent: "bg-accent/12",
	plain: "bg-surface-2",
	live: "bg-live/10",
	warn: "bg-warn/10",
	ok: "bg-ok/10",
	danger: "bg-danger/12",
} as const;
const TONE_DOT = {
	accent: "bg-accent",
	plain: "bg-text-3",
	live: "bg-live breathe",
	warn: "bg-warn",
	ok: "bg-ok",
	danger: "bg-danger",
} as const;

/**
 * The Situation row (#811): the agent's brief (three lines, the rest on
 * click), up to four facts, what the service depends on, and the Next strip
 * with the one next action. Never scrolls and never clips the strip.
 */
export function SituationCard({
	o,
	onAction,
	canStart = true,
	compact = false,
	watching = false,
	omit = [],
	limited = false,
}: {
	/** Actions the page already offers elsewhere, such as the run strip's Retry. */
	omit?: NextActionId[];
	/** The finding rests on code alone: the agent could not read alerts or metrics. */
	limited?: boolean;
	/** The page already shows the live run, so Watch would go nowhere. */
	watching?: boolean;
	/** Above a transcript: two lines of brief and no dependencies line (D19). */
	compact?: boolean;
	o: Overview;
	onAction: (id: NextActionId) => void;
	/** The box's agent is known; until then a start would send no harness. */
	canStart?: boolean;
}) {
	const { incident, runs } = o.record;
	const now = useNow(30_000) ?? Date.now();
	const [open, setOpen] = useState(false);
	const harnesses = useHarnesses();
	const report = o.report;
	const waiting =
		!!o.live && (o.latestRun.awaiting || !!o.live.awaitingApprovalAt);
	const brief =
		report?.summary ??
		incidentSummary({
			now,
			alerts: incident.alerts ?? [],
			services: incidentServices(incident).map((s) => s.name),
			runs,
			noRepo: false,
			attention: attentionFor(incident),
			ended: isIncidentEnded(incident.status),
			waiting,
		}).lines.join(" ");

	const trend = firingOf(incident, now);
	const serviceNames = incidentServices(incident).map((s) => s.name);
	const where =
		serviceNames.length > 0 || (incident.alerts ?? []).length > 0
			? {
					services: serviceNames.join(", ") || "No service",
					firing: firingWord(incident.alerts ?? [], now),
				}
			: null;
	const facts: { k: string; v: string; tone?: string }[] = [];
	if (trend === "worse")
		facts.push({ k: "Alert trend", v: "Getting worse", tone: "text-danger" });
	else if (trend === "steady") facts.push({ k: "Alert trend", v: "Steady" });
	else if (trend === "clear")
		facts.push({ k: "Alert trend", v: "Recovered", tone: "text-ok" });
	const category = causeCategory(
		incident.actualCauseCategory,
		report?.rootCauseCategory,
	);
	if (category)
		facts.push({ k: "Cause", v: ROOT_CAUSE_CATEGORY_LABEL[category] });
	if (report?.culprit?.changeRef)
		facts.push({ k: "Change", v: report.culprit.changeRef });
	if (report?.culprit?.mechanism)
		facts.push({ k: "Mechanism", v: report.culprit.mechanism });

	const latest = o.latest;
	const latestState = o.latestRun.state;
	const harness = harnesses.data?.harnesses.find(
		(h) => h.id === latest?.harness,
	);
	const ended = endedRun(
		latest,
		latestState,
		latest ? viewName(runs, latest) : "",
		harness?.label,
		harness?.loginHint,
	);
	const strip = nextStrip({
		lastingFix: report?.nextSteps?.find((s) => s.kind === "lasting")?.title,
		ended: incident.status === "closed",
		cause: incident.actualCause,
		mergedInto: incident.mergedInto,
		refiredAs: incident.refiredAs,
		cleared: o.cleared,
		alertsCleared: incident.status === "resolved",
		runs: runs.filter((r) => r.kind !== "chat").length,
		noService: incidentServices(incident).length === 0,
		live: o.live
			? {
					name: viewName(runs, o.live),
					waiting,
				}
			: null,
		failed: ended.failed,
		interrupted: ended.interrupted,
		reported: !!report,
		option: o.current,
		stage: o.stage,
		checkable: o.checkable,
		hasNextOption: o.others.length > 0,
		unit: o.impact.impact?.metric?.unit,
		threshold: o.impact.impact?.metric?.threshold,
		flagged: o.flagged,
	});
	const dropped = watching ? [...omit, "watch" as const] : omit;
	if (strip.primary && dropped.includes(strip.primary.id))
		strip.primary = undefined;
	if (strip.secondary && dropped.includes(strip.secondary.id))
		strip.secondary = undefined;
	// Beside the live run itself, a Next with nothing to press only repeats the strip above (cp11).
	const quiet = watching && !strip.primary && !strip.secondary;

	return (
		<section
			aria-label="Situation"
			className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-pool bg-surface-1"
			data-testid="situation"
		>
			{compact && where && (
				// Above a transcript the header may truncate, so the card says what is affected and whether it fires.
				<p
					className="flex min-w-0 flex-wrap items-center gap-x-1.5 px-4 pt-2.5 text-meta text-text-3"
					data-testid="situation-where"
				>
					<span className="truncate">{where.services}</span>
					{where.firing && (
						<>
							<span aria-hidden>·</span>
							<span className={where.firing.firing ? "text-danger" : "text-ok"}>
								{where.firing.firing ? "Alert still firing" : "Alert cleared"}
							</span>
						</>
					)}
					{limited && (
						<>
							<span aria-hidden>·</span>
							<span className="text-warn" data-testid="situation-limited">
								From code only; alerts and metrics not read
							</span>
						</>
					)}
				</p>
			)}
			<div className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2 px-4 pt-3 pb-2">
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					className={cn(
						"min-h-6 min-w-0 flex-[1_1_360px] text-left text-[15px] leading-[22px] font-medium",
						!open && (compact ? "line-clamp-2" : "line-clamp-3"),
						!report && "text-text-2",
					)}
					dir="auto"
					data-testid="situation-brief"
				>
					{plain(brief)}
				</button>
				{facts.length > 0 && (
					<dl
						className={cn(
							"flex min-w-0 shrink flex-wrap justify-end gap-x-6 gap-y-1",
							// Above a phone's transcript the brief and Next are enough; the facts are in the panel.
							compact && "max-sm:hidden",
						)}
						data-testid="situation-facts"
					>
						{facts.slice(0, 4).map((f) => (
							<div key={f.k} className="flex max-w-[180px] min-w-0 flex-col">
								<dt className="text-meta text-text-3">{f.k}</dt>
								<Hint label={f.v}>
									<dd className={cn("truncate font-medium", f.tone)}>{f.v}</dd>
								</Hint>
							</div>
						))}
					</dl>
				)}
			</div>
			{!compact && <DependsLine deps={o.dependencies} />}
			{!quiet && (
				<div
					className={cn(
						"flex min-h-11 items-center gap-2.5 py-2 pr-3 pl-4",
						TONE_BG[strip.tone],
					)}
					data-testid="next-strip"
					data-tone={strip.tone}
				>
					<span className="shrink-0 text-meta font-medium text-text-3">
						Next
					</span>
					<span
						aria-hidden
						className={cn(
							"size-1.5 shrink-0 rounded-full",
							TONE_DOT[strip.tone],
						)}
					/>
					<span
						className="min-w-0 flex-1 text-text-1"
						dir="auto"
						aria-live="polite"
						data-testid="next-text"
					>
						{strip.text}
						{strip.link && (
							<>
								{" "}
								<Link
									to="/incidents/$id"
									params={{ id: strip.link.incidentId }}
									className="font-medium underline-offset-2 hover:underline"
									data-testid="next-refire"
								>
									{strip.link.label}
								</Link>
							</>
						)}
					</span>
					{strip.secondary && (
						<Button
							variant="secondary"
							className="h-7 shrink-0 bg-surface-3 hover:bg-surface-4"
							onClick={() => strip.secondary && onAction(strip.secondary.id)}
							disabled={o.busy || (startsRun(strip.secondary.id) && !canStart)}
							data-testid={`next-${strip.secondary.id}`}
						>
							{strip.secondary.label}
						</Button>
					)}
					{strip.primary && (
						<Button
							className="h-7 shrink-0"
							onClick={() => strip.primary && onAction(strip.primary.id)}
							disabled={o.busy || (startsRun(strip.primary.id) && !canStart)}
							data-testid={`next-${strip.primary.id}`}
						>
							{strip.primary.label}
						</Button>
					)}
				</div>
			)}
		</section>
	);
}

/** Agent text arrives as Markdown; the brief shows it as plain text. */
export function plain(s: string): string {
	return s
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/^#+\s*/gm, "")
		.replace(/\*\*|__|`/g, "")
		.replace(/^\s*[-*]\s+/gm, "")
		.replace(/\s*\n+\s*/g, " ")
		.trim();
}

/** "Depends on booklogr-db (database) and redis (cache), both healthy at 12:20." */
function DependsLine({ deps }: { deps: TopologyEdge[] }) {
	const { incidents } = useActiveIncidents();
	const now = useNow(30_000) ?? Date.now();
	if (deps.length === 0) return null;
	const shown = deps.slice(0, 3);
	const rest = deps.length - shown.length;
	const sick = (id: string) =>
		incidents.some(
			(i) =>
				i.service?.id === id && ["worse", "steady"].includes(firingOf(i, now)),
		);
	const bad = shown.filter((d) => sick(d.service.id));
	const tail =
		bad.length === 0
			? `${shown.length === 1 ? "healthy" : shown.length === 2 ? "both healthy" : "all healthy"} at ${formatClock(now)}.`
			: `${bad.map((d) => d.service.displayName || d.service.name).join(" and ")} ${bad.length === 1 ? "has" : "have"} an alert firing.`;
	return (
		<p
			className="flex min-w-0 items-center gap-2 px-4 pb-2.5 text-meta text-text-2"
			data-testid="situation-depends"
		>
			<Database className="size-3 shrink-0" aria-hidden />
			<span className="min-w-0 truncate">
				Depends on{" "}
				{shown.map((d, i) => (
					<Fragment key={d.service.id}>
						{i > 0 && (i === shown.length - 1 && rest === 0 ? " and " : ", ")}
						<Link
							to="/services/$id"
							params={{ id: d.service.id }}
							className="text-text-1 underline-offset-2 hover:underline"
						>
							{d.service.displayName || d.service.name}
						</Link>{" "}
						({SERVICE_TYPE_LABEL[d.service.type].toLowerCase()})
					</Fragment>
				))}
				{rest > 0 && ` and ${rest} more`}, {tail}
			</span>
		</p>
	);
}
