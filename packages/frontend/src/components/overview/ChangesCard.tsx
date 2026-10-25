// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { GitCommitHorizontal } from "lucide-react";
import { useMemo } from "react";
import { dayClock } from "@/components/run/run-labels";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import type { Overview } from "./use-overview";
import {
	beforeAlert,
	changeDetail,
	changeName,
	changesProblem,
	mergeTimeline,
	type RowTone,
} from "./what-changed";

const DOT: Record<RowTone, string> = {
	danger: "bg-danger",
	accent: "bg-accent",
	live: "bg-live breathe",
	ok: "bg-ok",
	plain: "bg-text-3",
};
const LATEST = 6;

/**
 * What changed and when (#811): the deploy before the incident, then the
 * incident's own timeline merged with its git history, newest first. Latest
 * six; "All N events" lists the rest in the card, which scrolls.
 */
export function ChangesCard({ o }: { o: Overview }) {
	const now = useNow(30_000);
	const { incident, runs, timeline, timelineLoading } = o.record;
	const changes = o.changes;
	const rows = useMemo(
		() => mergeTimeline(timeline, changes?.timeline ?? [], runs),
		[timeline, changes?.timeline, runs],
	);
	const total =
		rows.filter((r) => r.key.startsWith("t:")).length + (changes?.total ?? 0);
	const shown = o.allChanges ? rows : rows.slice(0, LATEST);
	const problem = changesProblem(changes);
	const deploy = changes?.deploy ?? null;
	const reading = changes?.state === "pending" || changes?.refreshing;
	return (
		<Card
			title="What changed and when"
			testId="changes-card"
			actions={
				total > LATEST ? (
					<button
						type="button"
						onClick={() => o.setAllChanges(!o.allChanges)}
						className="text-meta text-accent hover:underline"
						aria-expanded={o.allChanges}
						data-testid="changes-all"
					>
						{o.allChanges ? `Latest ${LATEST}` : `All ${total} events`}
					</button>
				) : null
			}
		>
			<div className="flex flex-col gap-2">
				{deploy && (
					<DeployCard
						name={changeName(deploy)}
						detail={changeDetail(deploy)}
						at={deploy.at}
						started={incident.createdAt}
						url={deploy.url}
						now={now}
						hasAlert={(incident.alerts ?? []).length > 0}
					/>
				)}
				{problem && (
					<div
						className="flex min-w-0 items-center gap-2.5 rounded-surface bg-surface-2 px-3 py-2"
						data-testid="changes-problem"
					>
						<span className="min-w-0 flex-1 text-text-2">{problem.text}</span>
						{problem.action && (
							<Button
								variant="secondary"
								className="h-[26px] shrink-0 bg-surface-3 hover:bg-surface-4"
								asChild
							>
								{problem.action.to === "service" && incident.service ? (
									<Link to="/services/$id" params={{ id: incident.service.id }}>
										{problem.action.label}
									</Link>
								) : (
									<Link to="/settings" search={{ tab: "sources" }}>
										{problem.action.label}
									</Link>
								)}
							</Button>
						)}
					</div>
				)}
				{reading && !deploy && (
					<p className="flex items-center gap-2 text-meta text-text-3">
						<span
							aria-hidden
							className="breathe size-1.5 rounded-full bg-live"
						/>
						Reading the git history
					</p>
				)}
				{!timelineLoading && rows.length === 0 ? (
					<p className="text-text-3">No events yet.</p>
				) : (
					<ol className="flex flex-col" data-testid="changes-timeline">
						{shown.map((r) => (
							<li
								key={r.key}
								className="flex min-w-0 items-center gap-2.5 px-1 py-1.5 shadow-[inset_0_-1px_0_var(--hairline)]"
								data-row
								data-testid="changes-row"
							>
								<Hint label={formatDateTime(r.at)} side="left">
									<span className="w-[104px] shrink-0 text-meta text-text-3 tabular-nums">
										{dayClock(r.at, now)}
									</span>
								</Hint>
								<span
									aria-hidden
									className={cn("size-1.5 shrink-0 rounded-full", DOT[r.tone])}
								/>
								<RowText row={r} incidentId={incident.id} />
							</li>
						))}
					</ol>
				)}
			</div>
		</Card>
	);
}

function RowText({
	row,
	incidentId,
}: {
	row: ReturnType<typeof mergeTimeline>[number];
	incidentId: string;
}) {
	const cls = "min-w-0 truncate";
	const inner = (
		<Hint label={row.text}>
			<span className={cls} dir="auto">
				{row.text}
			</span>
		</Hint>
	);
	if (row.runId)
		return (
			<Link
				to="/incidents/$id/conversation"
				params={{ id: incidentId }}
				search={{ investigation: row.runId }}
				className={cn(cls, "hover:text-accent")}
				dir="auto"
			>
				{row.text}
			</Link>
		);
	if (row.incidentId)
		return (
			<Link
				to="/incidents/$id"
				params={{ id: row.incidentId }}
				className={cn(cls, "hover:text-accent")}
				dir="auto"
				data-testid="changes-merge-link"
			>
				{row.text}
			</Link>
		);
	if (row.url)
		return (
			<a
				href={row.url}
				target="_blank"
				rel="noreferrer"
				className={cn(cls, "hover:text-accent")}
				dir="auto"
			>
				{row.text}
			</a>
		);
	return inner;
}

function DeployCard({
	name,
	detail,
	at,
	started,
	url,
	now,
	hasAlert,
}: {
	name: string;
	detail: string;
	at: string;
	started: string;
	url: string | null;
	now: number | null;
	hasAlert: boolean;
}) {
	const m = Math.round((Date.parse(started) - Date.parse(at)) / 60_000);
	const rel =
		m >= 0 && m < 120 ? `, ${beforeAlert(at, started, hasAlert)}` : "";
	const body = (
		<>
			<GitCommitHorizontal
				className="size-4 shrink-0 text-accent"
				aria-hidden
			/>
			<span className="shrink-0 font-medium">{name}</span>
			<span className="min-w-0 flex-1 truncate text-text-2">{detail}</span>
			<Hint label={`${formatDateTime(at)}${rel}`}>
				<span className="shrink-0 text-meta text-text-3">
					{dayClock(at, now)}
				</span>
			</Hint>
		</>
	);
	const cls =
		"flex min-w-0 items-center gap-2.5 rounded-surface bg-surface-2 px-3 py-2 whitespace-nowrap";
	return url ? (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className={cn(
				cls,
				"transition-colors duration-(--dur-instant) hover:bg-surface-3",
			)}
			data-testid="changes-deploy"
		>
			{body}
		</a>
	) : (
		<div className={cls} data-testid="changes-deploy">
			{body}
		</div>
	);
}
