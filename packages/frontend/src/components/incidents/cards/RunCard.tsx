// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ComposerBox } from "@/components/investigation/ComposerBox";
import { Mono } from "@/components/shared/Mono";
import { StateChip, StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { STALE_AFTER_S } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
import { runElapsed } from "../RunStrip";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";

function plural(n: number, word: string) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The Run card (#743 §3c.1). No run: the box that starts one, in brief mode.
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
			<Card title="Run" count="None yet" testId="run-card">
				{inPanel ? (
					<p className="text-record text-muted-foreground">
						No investigation yet.
					</p>
				) : (
					<ComposerBox
						mode="brief"
						onInvestigate={(brief) => record.investigate(brief || undefined)}
						isPending={record.isInvestigating}
						blockedReason={
							!record.canInvestigate
								? "Only an open incident can be investigated."
								: record.investigateBlocked
						}
					/>
				)}
			</Card>
		);
	}

	if (!investigation || !run.state) {
		return (
			<Card title="Run" testId="run-card">
				<p className="text-record text-muted-foreground">
					{run.error ? "The run did not load." : "Loading the run…"}
				</p>
			</Card>
		);
	}

	const events = plural(run.events.length, "event");
	const state = run.state;

	if (state === "starting" || state === "working" || state === "stopping") {
		const age =
			run.lastEventAt && now !== null
				? Math.round((now - new Date(run.lastEventAt).getTime()) / 1000)
				: null;
		return (
			<Card title="Run" count={events} aside={open} testId="run-card">
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
			</Card>
		);
	}

	if (state === "stopped") {
		return (
			<Card title="Run" count={events} aside={open} testId="run-card">
				{run.latestText && (
					<p className="line-clamp-2 text-record">{run.latestText}</p>
				)}
				<StateWord tone="stale">
					Stopped by you
					{investigation.completedAt
						? ` at ${formatClock(investigation.completedAt)}`
						: ""}
				</StateWord>
			</Card>
		);
	}

	if (state === "failed") {
		return (
			<Card
				title="Run"
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
			</Card>
		);
	}

	return (
		<Card title="Run" count={events} aside={open} testId="run-card">
			<p className="flex items-center gap-2 text-meta text-muted-foreground">
				<StateWord tone="done">Done</StateWord>
				<span className="tabular-nums">
					in {formatElapsed(runElapsed(investigation, now))}
				</span>
				{investigation.completedAt && (
					<span>{ago(investigation.completedAt, now)}</span>
				)}
			</p>
		</Card>
	);
}
