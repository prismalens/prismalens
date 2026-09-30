// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { RUN_STATE_LABEL, runState } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Mono } from "@/components/shared/Mono";
import { StateChip, StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { STALE_AFTER_S } from "@/lib/investigation-events";
import { runStateTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";
import { runElapsed } from "../RunStrip";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";

function plural(n: number, word: string) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The Investigation card (#743 §3c.1). None yet: a pointer to the box that starts one.
 * Live: the agent's latest sentence and how long since its last step. Ended:
 * how it ended and the way into the conversation.
 */
export function RunCard({ inPanel = false }: { inPanel?: boolean }) {
	const record = useIncidentRecord();
	const { incident, run, investigationId } = record;
	const now = useNow(1000);
	const investigation = run.investigation;
	const open = !inPanel && (
		<CardLink
			incidentId={incident.id}
			to="conversation"
			testId="run-card-open-conversation"
		>
			Open conversation
		</CardLink>
	);

	if (!investigationId) {
		return (
			<Card title="Investigation" testId="run-card">
				<p className="text-record text-muted-foreground">
					No investigation yet.
					{!inPanel && " Start one from the box below."}
				</p>
			</Card>
		);
	}

	if (!investigation || !run.state) {
		return (
			<Card title="Investigation" testId="run-card">
				<p className="text-record text-muted-foreground">
					{run.error
						? "The investigation did not load."
						: "Loading the investigation…"}
				</p>
			</Card>
		);
	}

	const events = plural(run.events.length, "event");
	const state = run.state;
	const earlier = !inPanel && <OtherInvestigations />;

	if (state === "starting" || state === "working" || state === "stopping") {
		const age =
			run.lastEventAt && now !== null
				? Math.round((now - new Date(run.lastEventAt).getTime()) / 1000)
				: null;
		return (
			<Card title="Investigation" count={events} aside={open} testId="run-card">
				<p
					key={run.latestText ?? "starting"}
					className="line-clamp-2 min-h-10 text-record motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
					data-testid="run-card-latest"
				>
					{run.latestText ?? "Starting the agent…"}
				</p>
				<div className="flex items-center gap-2 text-meta text-muted-foreground">
					<span
						className={cn(
							"tabular-nums transition-colors duration-300 motion-reduce:transition-none",
							age !== null && age > STALE_AFTER_S && "text-stale",
						)}
					>
						{age === null
							? "No step yet"
							: `Last step ${formatElapsed(age)} ago`}
					</span>
					{run.streamFailed && (
						<StateChip tone="stale" data-testid="run-card-polling">
							polling
						</StateChip>
					)}
				</div>
				{earlier}
			</Card>
		);
	}

	if (state === "stopped") {
		return (
			<Card title="Investigation" count={events} aside={open} testId="run-card">
				{run.latestText && (
					<p className="line-clamp-2 text-record">{run.latestText}</p>
				)}
				<StateWord tone="stale">
					Stopped by you
					{investigation.completedAt
						? ` at ${formatClock(investigation.completedAt)}`
						: ""}
				</StateWord>
				{earlier}
			</Card>
		);
	}

	if (state === "failed") {
		return (
			<Card
				title="Investigation"
				count={events}
				aside={open}
				tone="failed"
				testId="run-card"
			>
				<p className="flex items-start gap-2 text-record text-run-failed">
					<StateWord tone="failed" className="mt-0.5">
						Failed
					</StateWord>
					<span className="line-clamp-2 min-w-0">
						{investigation.error ?? "No error was recorded."}
					</span>
				</p>
				<p className="text-meta text-muted-foreground">
					The last events are in the conversation. The raw transcript is at{" "}
					<Mono>runs/{investigation.id}/transcript.jsonl</Mono> under the
					workspace directory pl up printed at start.
				</p>
				{earlier}
			</Card>
		);
	}

	return (
		<Card title="Investigation" count={events} aside={open} testId="run-card">
			<p className="flex items-center gap-2 text-meta text-muted-foreground">
				<StateWord tone="done">Done</StateWord>
				<span className="tabular-nums">
					in {formatElapsed(runElapsed(investigation, now))}
				</span>
				{investigation.completedAt && (
					<span>{ago(investigation.completedAt, now)}</span>
				)}
			</p>
			{earlier}
		</Card>
	);
}

/**
 * The incident's other investigations, newest first (#743): each opens in
 * the Conversation tab. Three at most; the picker by the status has them all.
 */
function OtherInvestigations() {
	const { incident, runs, investigationId } = useIncidentRecord();
	const now = useNow();
	const navigate = useNavigate();
	const others = runs
		.map((r, i) => ({ r, n: runs.length - i }))
		.filter(({ r }) => r.id !== investigationId);
	if (others.length === 0) return null;
	return (
		<div className="space-y-0.5 pt-1" data-testid="run-card-others">
			<p className="text-meta text-muted-foreground">Other investigations</p>
			{others.slice(0, 3).map(({ r, n }) => {
				const state = runState(r.status, { hasEvents: true });
				return (
					<button
						key={r.id}
						type="button"
						onClick={() =>
							navigate({
								to: "/incidents/$id/conversation",
								params: { id: incident.id },
								search: { investigation: r.id },
							})
						}
						className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-meta hover:bg-muted"
						data-testid="run-card-other"
					>
						<span className="tabular-nums text-foreground">#{n}</span>
						<StateWord tone={runStateTone(state)}>
							{RUN_STATE_LABEL[state]}
						</StateWord>
						<span className="ml-auto text-muted-foreground">
							{ago(r.createdAt, now)}
						</span>
					</button>
				);
			})}
		</div>
	);
}
