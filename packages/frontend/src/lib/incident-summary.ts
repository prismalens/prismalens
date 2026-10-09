// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentAttention,
	isAlertFiring,
	runState,
} from "@prismalens/contracts";
import { failureWords } from "./failure-words";

export interface SummaryInput {
	now: number;
	alerts: { status: string; triggeredAt: string }[];
	services: string[];
	/** Newest first. */
	runs: { status: string; error?: string | null; rootCause?: string | null }[];
	/** The latest investigation ran with no repository. */
	noRepo: boolean;
	attention: IncidentAttention | null;
	/** Resolved, closed or merged: nothing is left to do on it. */
	ended?: boolean;
	/** What a live run is doing right now, for the summary's run sentence. */
	step?: string | null;
}

export type NextStep = {
	kind: "acknowledge" | "link-repo" | "investigate" | "resolve" | "close";
	text: string;
} | null;

function roughly(seconds: number): string {
	const m = Math.round(seconds / 60);
	if (m < 60) return plural(Math.max(1, m), "minute");
	const h = Math.round(m / 60);
	return h < 48 ? plural(h, "hour") : plural(Math.round(h / 24), "day");
}

function plural(n: number, one: string, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * The incident in three sentences and the one thing to do next (#743), for
 * whoever opens it cold: what is firing, what the agent made of it, and what
 * limits that answer.
 */
export function incidentSummary(i: SummaryInput): {
	lines: string[];
	next: NextStep;
} {
	const lines: string[] = [];
	const firing = i.alerts.filter((a) => isAlertFiring(a.status)).length;
	const where = i.services.length > 0 ? ` on ${i.services.join(", ")}` : "";
	if (i.alerts.length === 0) lines.push("No alerts are correlated.");
	else {
		const first = Math.min(...i.alerts.map((a) => Date.parse(a.triggeredAt)));
		const since = roughly((i.now - first) / 1000);
		lines.push(
			firing > 0
				? `${firing} of ${plural(i.alerts.length, "alert")} firing${where}, the first ${since} ago.`
				: `${plural(i.alerts.length, "alert")}${where}, none firing now.`,
		);
	}

	const latest = i.runs[0];
	const state = latest ? runState(latest.status, { hasEvents: true }) : null;
	let failedWords: ReturnType<typeof failureWords> | null = null;
	if (!latest) lines.push("No investigation yet.");
	else if (state === "starting" || state === "working" || state === "stopping")
		lines.push(
			i.step
				? `An investigation is working now: ${i.step}.`
				: "An investigation is working now.",
		);
	else if (state === "done")
		lines.push(
			latest.rootCause
				? `The last investigation concluded: ${latest.rootCause}`
				: "The last investigation finished without naming a root cause.",
		);
	else if (state === "stopped")
		lines.push("The last investigation was stopped.");
	else {
		let streak = 0;
		while (
			streak < i.runs.length &&
			runState(i.runs[streak]?.status ?? "", { hasEvents: true }) === "failed"
		)
			streak++;
		failedWords = failureWords(latest.error);
		lines.push(
			`${streak > 1 ? `${streak} investigations in a row failed` : "The last investigation failed"}: ${failedWords.what.replace(/^The /, "the ")}`,
		);
	}
	if (i.noRepo)
		lines.push("No repository is linked, so the agent read no code.");

	const next: NextStep = i.ended
		? null
		: i.attention === "unacknowledged"
			? {
					kind: "acknowledge",
					text: "Acknowledge it so others know it is taken.",
				}
			: i.noRepo
				? {
						kind: "link-repo",
						text: "Link the service's repository, then investigate.",
					}
				: failedWords
					? { kind: "investigate", text: failedWords.next ?? "Try again." }
					: i.attention === "awaiting_close"
						? {
								kind: "close",
								text: "Its alerts cleared. Resolve it, with the cause if you know it.",
							}
						: state === "done"
							? { kind: "resolve", text: "Read the report, then resolve." }
							: !latest
								? { kind: "investigate", text: "Start an investigation." }
								: null;
	return { lines, next };
}
