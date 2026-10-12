// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentChange,
	IncidentChanges,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import type { RunRef } from "@/components/incidents/record-context";
import { entryTitle } from "@/components/incidents/TimelineList";
import { refRunState, runOutcome, viewName } from "@/components/run/run-labels";

export type RowTone = "danger" | "accent" | "live" | "ok" | "plain";

export interface ChangeRow {
	key: string;
	at: string;
	text: string;
	tone: RowTone;
	/** A change on the git host's web UI. */
	url?: string | null;
	/** A run or an Ask to open. */
	runId?: string;
	/** The other incident of a merge (#673 w5-17). */
	incidentId?: string;
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null);

/** `Deploy v1.42`, `Merged #12`, `Commit 3f9a2c1`: a change named the way the card shows it. */
export function changeName(c: IncidentChange): string {
	const ref = c.tag ?? short(c.sha);
	switch (c.kind) {
		case "deployment":
			return ref ? `Deploy ${ref}` : "Deploy";
		case "rollback":
			return ref ? `Rollback to ${ref}` : "Rollback";
		case "release":
			return `Release ${c.tag ?? short(c.sha) ?? ""}`.trim();
		case "merge":
			return c.pr ? `Merged #${c.pr}` : "Merge";
		case "config":
			return "Config change";
		case "migration":
			return "Migration";
		default:
			return ref ? `Commit ${ref}` : "Commit";
	}
}

/** What the change touched, or its title when the host gave no files. */
export function changeDetail(c: IncidentChange): string {
	if (c.files && c.files.count > 0) {
		const first = c.files.paths[0];
		const n = c.files.count;
		return first
			? `${n} ${n === 1 ? "file" : "files"}, including ${first}`
			: `${n} ${n === 1 ? "file" : "files"}`;
	}
	return c.title;
}

/**
 * A Continue on a finished run: the API logs it as `investigation_started`,
 * titled "... resumed" (#831 w6-29), so it never reads as the run's start.
 */
function isResume(e: TimelineEntryWithRelations): boolean {
	return e.type === "investigation_started" && /\bresumed$/i.test(e.title);
}

function entryRow(
	e: TimelineEntryWithRelations,
	runs: RunRef[],
): ChangeRow | null {
	const id = e.metadata?.investigationId;
	const run =
		typeof id === "string" ? (runs.find((r) => r.id === id) ?? null) : null;
	const base = { key: `t:${e.id}`, at: e.occurredAt };
	if (run && isResume(e)) {
		if (run.kind === "chat") return null;
		return {
			...base,
			text: `${viewName(runs, run)} continued`,
			tone: refRunState(run) === "working" ? "live" : "accent",
			runId: run.id,
		};
	}
	if (run && e.type === "investigation_started") {
		if (run.kind === "chat")
			return {
				...base,
				text: run.title ? `You asked: ${run.title}` : "You asked a question",
				tone: "plain",
				runId: run.id,
			};
		return {
			...base,
			text: `${viewName(runs, run)} started`,
			tone: refRunState(run) === "working" ? "live" : "accent",
			runId: run.id,
		};
	}
	if (run && e.type === "investigation_completed") {
		if (run.kind === "chat") return null;
		const state = refRunState(run);
		const outcome = runOutcome(run);
		return {
			...base,
			text:
				state === "failed" || state === "stopped"
					? `${viewName(runs, run)} ${outcome}`
					: `${viewName(runs, run)} concluded: ${outcome}`,
			tone: state === "failed" ? "danger" : "accent",
			runId: run.id,
		};
	}
	if (e.type === "comment")
		return { ...base, text: `Note: ${e.title}`, tone: "plain" };
	// Show the reason the backend wrote: the incident a refire follows, why a run was skipped (#673 w6-25, w6-26).
	const prior = e.metadata?.priorIncidentId;
	if (e.type === "incident_created")
		return typeof prior === "string" && e.description
			? { ...base, text: e.description, tone: "plain", incidentId: prior }
			: { ...base, text: "Incident opened", tone: "plain" };
	if (
		e.type === "custom" &&
		e.description &&
		!entryTitle(e).includes(e.description)
	)
		return {
			...base,
			text: `${entryTitle(e)}: ${e.description}`,
			tone: "plain",
		};
	const merged = e.metadata?.mergedIntoId ?? e.metadata?.mergedFromId;
	const incidentId =
		e.metadata?.reason === "merged" && typeof merged === "string"
			? { incidentId: merged }
			: {};
	if (e.type === "alert_added" || e.type === "alert_removed")
		return {
			...base,
			text: e.description ? `${e.title}: ${e.description}` : e.title,
			tone: e.type === "alert_added" ? "danger" : "plain",
			...incidentId,
		};
	if (e.type === "recommendation_completed")
		return { ...base, text: e.title, tone: "ok" };
	return { ...base, text: entryTitle(e), tone: "plain", ...incidentId };
}

/**
 * The incident's own timeline and what changed on its git hosts, one list,
 * newest first (#811). Entries a run wrote while it worked fold into its
 * start and end rows.
 */
export function mergeTimeline(
	entries: TimelineEntryWithRelations[],
	changes: IncidentChange[],
	runs: RunRef[],
): ChangeRow[] {
	const seenRun = new Set<string>();
	const rows: ChangeRow[] = [];
	for (const e of entries) {
		const id = e.metadata?.investigationId;
		const own =
			e.type === "investigation_started" ||
			e.type === "investigation_completed";
		if (typeof id === "string" && !own && e.type !== "recommendation_completed")
			continue;
		const row = entryRow(e, runs);
		if (!row) continue;
		// Each Continue is its own row; the start and the end show once per run.
		const once = isResume(e) ? e.id : `${e.type}:${String(id)}`;
		if (own && seenRun.has(once)) continue;
		if (own) seenRun.add(once);
		rows.push(row);
	}
	for (const c of changes)
		rows.push({
			key: `c:${c.id}`,
			at: c.at,
			text: `${changeName(c)}: ${c.title}`,
			tone: "accent",
			url: c.url,
		});
	return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The one thing to say about the git hosts, when there is one. */
export function changesProblem(changes: IncidentChanges | undefined): {
	text: string;
	action: { label: string; to: "settings" | "service" } | null;
} | null {
	if (!changes) return null;
	if (changes.state === "no-repos")
		return {
			text: "No repository is linked to this incident's services, so deploys and merges cannot show here.",
			action: { label: "Link a repository", to: "service" },
		};
	const problem = changes.sources.find((s) => s.problem)?.problem;
	if (!problem) return null;
	if (problem.action === "add-credential")
		return {
			text: "Add a git host token, or sign in to git on this machine, to see deploys and merges",
			action: { label: "Add a token", to: "settings" },
		};
	if (problem.action === "replace-token")
		return {
			text: problem.message,
			action: { label: "Replace the token", to: "settings" },
		};
	if (problem.action === "pick-credential")
		return {
			text: problem.message,
			action: { label: "Pick a credential", to: "settings" },
		};
	return { text: problem.message, action: null };
}
