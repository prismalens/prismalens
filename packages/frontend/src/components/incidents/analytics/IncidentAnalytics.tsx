// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	SEVERITY_LABEL,
	type Severity,
} from "@prismalens/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import {
	answerLine,
	byRecordedCause,
	byService,
	dayBars,
	type Share,
	shortDuration,
	tiles,
	windowFigures,
} from "@/lib/analytics";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { formatDate } from "@/lib/format-time";
import { attentionFor } from "@/lib/incident-attention";

const DAY = 86_400_000;

function useWindow(from: Date, to: Date | undefined, filter: string) {
	const { data, isLoading } = useQuery({
		...orpc.incidents.list.queryOptions({
			input: {
				fromDate: from,
				...(to ? { toDate: to } : {}),
				limit: 100,
			},
		}),
		refetchInterval: useLiveRefreshInterval(),
		// The window moves every minute; keep the figures up while the next key loads.
		placeholderData: keepPreviousData,
	});
	const needle = filter.trim().toLowerCase();
	const rows = useMemo(
		() =>
			(data?.data ?? []).filter(
				(i: IncidentWithRelations) =>
					!needle ||
					i.title.toLowerCase().includes(needle) ||
					(i.service?.displayName ?? i.service?.name ?? "")
						.toLowerCase()
						.includes(needle),
			),
		[data, needle],
	);
	return { rows, isLoading, capped: !!data?.pagination.hasMore };
}

/**
 * Analytics (study-v3 §3.6): the answer first, in one of three kinds of
 * month; then the numbers, each with one line of comparison; the secondary
 * figures; a bar per day coloured by severity with its key; incidents by
 * service and by recorded cause. No framed boxes, no "updated" stamps.
 */
export function IncidentAnalytics({
	filter,
	days,
	onWiden,
}: {
	filter: string;
	days: number;
	onWiden: () => void;
}) {
	// The window moves once a minute, with the clock that ticks the page.
	const now = useNow(60_000);
	const anchor = useMemo(() => now ?? Date.now(), [now]);
	const from = new Date(anchor - days * DAY);
	const before = new Date(anchor - 2 * days * DAY);
	const current = useWindow(from, undefined, filter);
	const previous = useWindow(before, from, filter);
	const { data: stats } = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});

	if (current.isLoading || previous.isLoading || !stats) return null;

	const fig = windowFigures(current.rows);
	const prev = windowFigures(previous.rows);
	// A filter narrows every number, the open ones too; unfiltered they are the workspace's.
	const filtered = filter.trim() !== "";
	const needYou = filtered
		? current.rows.filter((i) => attentionFor(i) !== null).length
		: Object.values(stats.attention).reduce((a, b) => a + b, 0);
	const openNow = filtered ? fig.open : stats.open;
	const answer = answerLine(fig, prev, days, needYou);

	if (answer.kind === "empty") {
		return (
			<div className="px-4 pt-6 pb-12 md:px-6" data-testid="analytics">
				<h2 className="text-display" data-testid="analytics-answer">
					{answer.lead}
				</h2>
				{days < 90 && (
					<button
						type="button"
						onClick={onWiden}
						className="mt-2 text-body text-accent hover:underline"
						data-testid="analytics-widen"
					>
						Show the last 90 days
					</button>
				)}
			</div>
		);
	}

	const bars = dayBars(current.rows, days, anchor);
	const peak = Math.max(1, ...bars.map((b) => b.count));
	const severities = new Set(
		bars.flatMap((b) => (b.severity ? [b.severity] : [])),
	);
	return (
		<div
			className="max-w-[56rem] px-4 pt-4 pb-12 md:px-6"
			data-testid="analytics"
		>
			<div data-testid="analytics-answer">
				<h2 className="text-display text-balance" data-testid="analytics-lead">
					{answer.lead}
					{answer.needYou !== null && answer.needYou > 0 && (
						<>
							{" "}
							<Link
								to="/incidents"
								search={{}}
								className="text-accent hover:underline"
								data-testid="analytics-need-you"
							>
								{answer.needYou} need{answer.needYou === 1 ? "s" : ""} you now
							</Link>
							.
						</>
					)}
				</h2>
				<p className="mt-1.5 text-body text-text-2">{answer.sub}</p>
			</div>

			<dl
				className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5"
				data-testid="analytics-numbers"
			>
				{tiles(fig, prev, days, openNow, needYou, answer.kind).map((t) => (
					<div key={t.key} className="min-w-0" data-testid={`tile-${t.key}`}>
						<dd className="text-[28px] leading-8 font-semibold tracking-tight tabular-nums">
							{t.value}
						</dd>
						<dt className="mt-1 text-meta text-text-3">{t.label}</dt>
						<dd className="text-meta text-text-2" data-testid="tile-line">
							{t.line}
						</dd>
					</div>
				))}
			</dl>

			<div className="mt-5 space-y-1 text-meta text-text-3">
				<p data-testid="analytics-cleared">
					Median time to resolve runs from the first alert to your Resolve; time
					until alerts cleared:{" "}
					{fig.cleared === null
						? "none recorded"
						: `median ${shortDuration(fig.cleared)}, from the first alert to the source clearing them`}
					.
				</p>
				<p data-testid="analytics-match">
					{fig.matchOf > 0
						? `Agent's cause matched yours on ${fig.matched} of ${fig.matchOf} resolved incidents where you recorded a category (a five-bucket match).`
						: "Agent's cause matched yours: nothing to compare yet, on resolved incidents where you recorded a category and the agent named one (a five-bucket match)."}
				</p>
			</div>

			<section className="mt-10" aria-labelledby="by-day">
				<h3 id="by-day" className="text-heading">
					Incidents by day
				</h3>
				<div
					className="mt-3 flex h-36 items-end gap-0.5"
					role="img"
					aria-label={`Incidents per day over the last ${days} days`}
					data-testid="analytics-days"
				>
					{bars.map((b) => (
						<span
							key={b.day}
							title={`${formatDate(b.day)}: ${b.count}`}
							className="min-w-0 flex-1 rounded-t-[2px]"
							style={{
								height: b.count ? `${(b.count / peak) * 100}%` : "2px",
								background: b.severity
									? `var(--sev-${b.severity})`
									: "var(--hairline-strong)",
							}}
						/>
					))}
				</div>
				<div className="mt-1 flex justify-between text-meta text-text-3">
					<span>{formatDate(bars[0]?.day ?? anchor)}</span>
					<span>{formatDate(bars.at(-1)?.day ?? anchor)}</span>
				</div>
				<p
					className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-text-3"
					data-testid="analytics-key"
				>
					{(["critical", "high", "medium", "low", "info"] as Severity[])
						.filter((s) => severities.has(s))
						.map((s) => (
							<span key={s} className="inline-flex items-center gap-1.5">
								<span
									aria-hidden
									className="size-2 rounded-[2px]"
									style={{ background: `var(--sev-${s})` }}
								/>
								{SEVERITY_LABEL[s]}
							</span>
						))}
				</p>
			</section>

			<div className="mt-10 grid gap-10 md:grid-cols-2">
				<Breakdown title="By service" rows={byService(current.rows)} />
				<Breakdown
					title="By recorded cause"
					rows={byRecordedCause(current.rows)}
					empty="Nothing resolved in this window."
				/>
			</div>
			{current.capped && (
				<p className="mt-6 text-meta text-text-3">
					Counted from the 100 newest incidents in this window.
				</p>
			)}
		</div>
	);
}

function Breakdown({
	title,
	rows,
	empty,
}: {
	title: string;
	rows: Share[];
	empty?: string;
}) {
	const top = Math.max(1, ...rows.map((r) => r.count));
	return (
		<section aria-label={title} data-testid="analytics-breakdown">
			<h3 className="mb-2.5 text-heading">{title}</h3>
			{rows.length === 0 ? (
				<p className="text-meta text-text-3">{empty}</p>
			) : (
				<ul className="grid gap-2">
					{rows.map((r) => (
						<li
							key={r.key}
							className="grid grid-cols-[minmax(0,8rem)_1fr_2rem] items-center gap-3 text-meta"
						>
							<span className="truncate text-text-2">{r.label}</span>
							<span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
								<span
									className="block h-full rounded-full bg-accent"
									style={{ width: `${(r.count / top) * 100}%` }}
								/>
							</span>
							<span className="text-right text-text-3 tabular-nums">
								{r.count}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
