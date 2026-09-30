// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { RUN_STATE_LABEL, runState } from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateChip, StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { failureWords } from "@/lib/failure-words";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { STALE_AFTER_S } from "@/lib/investigation-events";
import { runStateTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";
import { runElapsed } from "../RunStrip";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";
import { useRanWithoutRepo } from "./SummaryBlock";

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
	const earlier = !inPanel && (
		<>
			<NoRepoLine />
			<OtherInvestigations />
		</>
	);

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
				<FailedLines error={investigation.error} />
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
 * the Conversation tab. Newest first, three until asked for more.
 */
function OtherInvestigations() {
	const { incident, runs, investigationId } = useIncidentRecord();
	const now = useNow();
	const navigate = useNavigate();
	const [all, setAll] = useState(false);
	const others = runs
		.map((r, i) => ({ r, n: runs.length - i }))
		.filter(({ r }) => r.id !== investigationId);
	if (others.length === 0) return null;
	return (
		<div className="space-y-0.5 pt-1" data-testid="run-card-others">
			<p className="text-meta text-muted-foreground">Other investigations</p>
			{(all ? others : others.slice(0, 3)).map(({ r, n }) => {
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
						<StateWord tone={runStateTone(state)} className="shrink-0">
							{RUN_STATE_LABEL[state]}
						</StateWord>
						{state === "failed" && (
							<span className="min-w-0 truncate text-muted-foreground">
								{failureWords(r.error).what}
							</span>
						)}
						<span className="ml-auto shrink-0 text-muted-foreground">
							{ago(r.createdAt, now)}
						</span>
					</button>
				);
			})}
			{others.length > 3 && (
				<button
					type="button"
					onClick={() => setAll((v) => !v)}
					className="px-1 text-meta text-primary hover:underline"
				>
					{all ? "Show fewer" : `Show ${others.length - 3} more`}
				</button>
			)}
		</div>
	);
}

/** A failure said once, in words an operator can act on; the raw error one click away. */
function FailedLines({ error }: { error: string | null | undefined }) {
	const words = failureWords(error);
	return (
		<div className="space-y-1" data-testid="run-card-failure">
			<p className="text-record">
				<StateWord tone="failed" className="mr-2">
					Failed
				</StateWord>
				{words.what}
			</p>
			{words.next && (
				<p className="text-meta text-muted-foreground">{words.next}</p>
			)}
			{error && (
				<details className="text-meta text-muted-foreground">
					<summary className="cursor-pointer select-none">The error</summary>
					<Mono className="mt-1 block whitespace-pre-wrap break-words">
						{error}
					</Mono>
				</details>
			)}
		</div>
	);
}

/** It ran with no repository: the agent read no code, which bounds everything it said. */
function NoRepoLine() {
	const { incident, investigationId } = useIncidentRecord();
	const noRepo = useRanWithoutRepo(investigationId);
	if (!noRepo) return null;
	const serviceId = incident.service?.id;
	return (
		<p
			className="rounded border border-stale/40 bg-stale/10 px-2 py-1 text-meta"
			data-testid="run-card-no-repo"
		>
			No repository linked, so the agent read no code.{" "}
			{serviceId && (
				<Link
					to="/services/$id"
					search={{ tab: "repositories" }}
					params={{ id: serviceId }}
					className="text-primary hover:underline"
				>
					Link one
				</Link>
			)}
		</p>
	);
}
