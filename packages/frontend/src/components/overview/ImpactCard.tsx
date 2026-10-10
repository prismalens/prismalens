// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ImpactChart } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import {
	CHART_H,
	CHART_W,
	chartGeometry,
	formatValue,
	stripDays,
	stripSpan,
} from "./impact";

export interface ImpactView {
	impact: ImpactChart | null;
	/** No answer yet; past 10 seconds it reads as slow. */
	pending: boolean;
	slow: boolean;
	/** The request itself failed. */
	failed: string | null;
	/** The incident's alerts firing now. */
	firing: number;
	retry: () => void;
}

type Charted = ImpactChart & { metric: NonNullable<ImpactChart["metric"]> };

function charted(i: ImpactChart | null): Charted | null {
	return i?.metric &&
		i.series.length > 0 &&
		(i.state === "ok" || i.metric.source === "service")
		? (i as Charted)
		: null;
}

/** The sub line: where the series comes from, and what it is of. */
function subOf(i: Charted): string {
	const from = i.connection ? `from ${i.connection.label}, ` : "";
	if (i.metric.source === "service")
		return `The service's metric, not this alert's, ${from}last 24 hours`;
	if (i.metric.source === "alert_current_rule")
		return `The alert's rule as loaded now; it may have changed since this alert fired, ${from}last 24 hours`;
	return `The alert's own query, ${from}last 24 hours`;
}

/**
 * Impact (#811): the alert's own query re-run on the metrics source, with
 * its threshold and deploys; without a source, what the alert itself says
 * about the last week. The Errors and SLO tiles are cut until a source exists.
 */
export function ImpactCard({ view }: { view: ImpactView }) {
	const { impact, pending, slow, failed, retry } = view;
	const chart = charted(impact);
	const timedOut = slow || impact?.state === "timeout";
	const broken =
		failed ??
		(impact?.state === "error"
			? (impact.error ?? "it refused the query")
			: null);
	const sub = chart
		? subOf(chart)
		: pending && !slow
			? "Asking the metrics source"
			: timedOut || broken
				? "The metrics source did not answer"
				: "From the alert alone";
	return (
		<Card
			title="Impact"
			sub={
				<span className="min-w-0 truncate text-meta text-text-3">{sub}</span>
			}
			testId="impact-card"
		>
			{chart ? (
				<Chart impact={chart} />
			) : pending && !slow ? (
				<div
					className="flex h-full min-h-0 flex-col gap-2"
					data-testid="impact-pending"
				>
					<span className="text-meta text-text-3">
						Asking for the last 24 hours
					</span>
					<Skeleton className="min-h-[60px] flex-1 rounded-control" />
				</div>
			) : timedOut || broken ? (
				<div
					className="flex h-full flex-col items-start justify-center gap-2.5"
					data-testid="impact-slow"
				>
					<p className="text-text-2">
						{timedOut
							? "The metrics source has not answered for 10 seconds. Nothing else on this page waits for it."
							: `The metrics source answered with an error: ${broken}`}
					</p>
					<Button
						variant="secondary"
						className="h-7 bg-surface-3 hover:bg-surface-4"
						onClick={retry}
						data-testid="impact-retry"
					>
						Try again
					</Button>
				</div>
			) : impact ? (
				<NoSource impact={impact} firing={view.firing} />
			) : null}
		</Card>
	);
}

function Chart({ impact }: { impact: Charted }) {
	const g = useMemo(() => chartGeometry(impact), [impact]);
	const several = impact.series.length > 1;
	const threshold = impact.metric.threshold;
	const over =
		threshold && impact.now !== null ? breaches(impact.now, threshold) : false;
	const name =
		impact.metric.source === "service"
			? "Service metric"
			: several
				? `${impact.series.length} series match`
				: "This alert's series";
	return (
		<div className="flex h-full min-h-0 gap-5" data-testid="impact-chart">
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-text-3">
					<Hint label={impact.metric.query}>
						<span className="flex items-center gap-1.5">
							<span aria-hidden className="h-0.5 w-2.5 bg-danger" />
							{name}
						</span>
					</Hint>
					{threshold && (
						<span className="flex items-center gap-1.5">
							<svg aria-hidden width="10" height="2" className="shrink-0">
								<line
									x1="0"
									y1="1"
									x2="10"
									y2="1"
									stroke="var(--warn)"
									strokeDasharray="3 2"
								/>
							</svg>
							Alert fires {opWord(threshold.op)} {formatValue(threshold.value)}
						</span>
					)}
					{g.deploys.map((d) => (
						<span
							key={`${d.x}-${d.label}`}
							className="flex items-center gap-1.5"
						>
							<span aria-hidden className="h-2.5 w-0.5 bg-accent" />
							{d.label}
						</span>
					))}
				</div>
				<div className="flex min-h-[60px] flex-1 gap-1.5">
					<div
						aria-hidden
						className="relative w-8 shrink-0 text-right text-[11px] leading-3 text-text-3"
					>
						{g.ticks.map((t) => (
							<span
								key={t.value}
								className="absolute right-0"
								style={{ top: `calc(${(t.y / CHART_H) * 100}% - 6px)` }}
							>
								{formatValue(t.value)}
							</span>
						))}
					</div>
					<div className="min-w-0 flex-1">
						<svg
							viewBox={`0 0 ${CHART_W} ${CHART_H}`}
							preserveAspectRatio="none"
							width="100%"
							height="100%"
							role="img"
							aria-label={chartLabel(impact, name)}
							className="block"
						>
							{g.ticks.map((t) => (
								<line
									key={t.value}
									x1="0"
									x2={CHART_W}
									y1={t.y}
									y2={t.y}
									stroke="var(--hairline)"
									vectorEffect="non-scaling-stroke"
								/>
							))}
							{g.thresholdY !== null && (
								<line
									x1="0"
									x2={CHART_W}
									y1={g.thresholdY}
									y2={g.thresholdY}
									stroke="var(--warn)"
									strokeDasharray="4 4"
									vectorEffect="non-scaling-stroke"
								/>
							)}
							{g.deploys.map((d) => (
								<line
									key={`${d.x}-${d.label}`}
									x1={d.x}
									x2={d.x}
									y1="0"
									y2={CHART_H}
									stroke="var(--accent)"
									strokeWidth="1.5"
									vectorEffect="non-scaling-stroke"
								/>
							))}
							{g.area && (
								<polygon
									points={g.area}
									fill="oklch(from var(--danger) l c h / 0.12)"
								/>
							)}
							{g.lines.map((l, i) => (
								<polyline
									// biome-ignore lint/suspicious/noArrayIndexKey: series have no identity but their order.
									key={i}
									points={l}
									fill="none"
									stroke="var(--danger)"
									strokeWidth={several ? 1.25 : 2}
									strokeOpacity={several ? 0.7 : 1}
									strokeLinejoin="round"
									vectorEffect="non-scaling-stroke"
								/>
							))}
						</svg>
					</div>
				</div>
				<div className="relative ml-[38px] h-4 text-meta text-text-3">
					{g.xLabels.map((x) => (
						<span key={x.x} className="absolute" style={{ left: `${x.x}%` }}>
							{x.label}
						</span>
					))}
					<span className="absolute right-0">Now</span>
				</div>
			</div>
			{impact.now !== null && (
				<dl className="flex w-[120px] shrink-0 flex-col justify-center gap-3">
					<div>
						<dt className="text-meta text-text-3">Now</dt>
						<dd
							className={cn(
								"text-display",
								over ? "text-danger" : "text-text-1",
							)}
							data-testid="impact-now"
						>
							{formatValue(impact.now)}
						</dd>
						{impact.usual !== null && (
							<dd className="text-meta text-text-2">
								Usually {formatValue(impact.usual)}
							</dd>
						)}
					</div>
				</dl>
			)}
		</div>
	);
}

const opWord = (op: string) =>
	op.startsWith("<")
		? "below"
		: op === "=="
			? "at"
			: op === "!="
				? "away from"
				: "above";

function breaches(v: number, t: { op: string; value: number }): boolean {
	switch (t.op) {
		case ">":
			return v > t.value;
		case ">=":
			return v >= t.value;
		case "<":
			return v < t.value;
		case "<=":
			return v <= t.value;
		case "==":
			return v === t.value;
		default:
			return v !== t.value;
	}
}

function chartLabel(impact: Charted, name: string): string {
	const parts = [`${name} over the last 24 hours`];
	if (impact.now !== null) parts.push(`now ${formatValue(impact.now)}`);
	if (impact.usual !== null) parts.push(`usually ${formatValue(impact.usual)}`);
	if (impact.metric.threshold)
		parts.push(
			`the alert fires at ${formatValue(impact.metric.threshold.value)}`,
		);
	return parts.join(", ");
}

/** No metrics source, or no query to ask it: firing time, alert count, refires, the 7-day strip. */
function NoSource({ impact, firing }: { impact: ImpactChart; firing: number }) {
	const now = useNow(30_000) ?? Date.now();
	const h = impact.history;
	const firingFor =
		h.firingSince && !h.resolvedAt ? now - Date.parse(h.firingSince) : null;
	return (
		<div
			className="flex h-full flex-col gap-3.5"
			data-testid="impact-no-source"
		>
			<dl className="grid grid-cols-3 gap-3">
				<div className="min-w-0">
					<dt className="text-meta text-text-3">Firing for</dt>
					<dd
						className={cn(
							"truncate text-display",
							firingFor !== null ? "text-danger" : "text-text-2",
						)}
					>
						{firingFor !== null
							? formatElapsed(Math.max(0, firingFor) / 1000)
							: "Not firing"}
					</dd>
				</div>
				<div className="min-w-0">
					<dt className="text-meta text-text-3">Alerts</dt>
					<dd className="truncate text-display">
						{firing} of {h.alertCount} firing
					</dd>
				</div>
				<div className="min-w-0">
					<dt className="text-meta text-text-3">Fired before</dt>
					<dd className="truncate text-display">
						{h.refiresThisWeek === 0
							? "Not this week"
							: `${h.refiresThisWeek} ${h.refiresThisWeek === 1 ? "time" : "times"} this week`}
					</dd>
				</div>
			</dl>
			<div className="flex flex-col gap-1.5">
				<span className="text-meta text-text-3">
					When this alert fired, last 7 days
				</span>
				<div className="relative h-6 overflow-hidden rounded-control bg-surface-2">
					{h.strip.map((e, i) => {
						const s = stripSpan(e, now);
						const current = i === h.strip.length - 1;
						const label = e.end
							? `Fired ${formatClock(e.start)} for ${formatElapsed((Date.parse(e.end) - Date.parse(e.start)) / 1000)}`
							: `Firing since ${formatClock(e.start)}`;
						return (
							<Hint key={e.start} label={label}>
								<span
									// biome-ignore lint/a11y/noNoninteractiveTabindex: each span's time is in its hint, reached by focus.
									tabIndex={0}
									role="img"
									aria-label={label}
									className={cn(
										"absolute inset-y-0",
										current ? "bg-danger" : "bg-danger/45",
									)}
									style={{ left: `${s.left}%`, width: `${s.width}%` }}
								/>
							</Hint>
						);
					})}
				</div>
				<div className="flex justify-between text-meta text-text-3">
					{stripDays(now).map((d, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: day names repeat only across weeks.
						<span key={i}>{d}</span>
					))}
				</div>
			</div>
			<Reason impact={impact} />
		</div>
	);
}

function Reason({ impact }: { impact: ImpactChart }) {
	const text =
		impact.state === "expression_unknown"
			? `No chart: ${impact.expression.reason ?? "the alert's query is not known"}.`
			: impact.state === "too_broad"
				? "No chart: the alert's query matches 50 series or more, too many to show which one is this alert."
				: "Connect Prometheus to see the trend and check a fix";
	return (
		<div className="mt-auto flex min-w-0 items-center gap-3 rounded-surface bg-surface-2 px-3 py-2">
			<span className="min-w-0 flex-1 text-text-2">{text}</span>
			{impact.state === "not_configured" ? (
				<Button
					variant="secondary"
					className="h-[26px] shrink-0 bg-surface-3 hover:bg-surface-4"
					asChild
				>
					<Link
						to="/settings"
						search={{ tab: "integrations" }}
						data-testid="impact-connect"
					>
						Connect Prometheus
					</Link>
				</Button>
			) : impact.linkOut ? (
				<Button
					variant="secondary"
					className="h-[26px] shrink-0 bg-surface-3 hover:bg-surface-4"
					asChild
				>
					<a href={impact.linkOut} target="_blank" rel="noreferrer">
						Open the query
					</a>
				</Button>
			) : null}
		</div>
	);
}
