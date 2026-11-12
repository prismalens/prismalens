// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What a thread list row says (#1020). Agent text (titles, step lines, causes)
 * is untrusted: these return plain strings for text nodes, never markup.
 */
import {
	isWorkflowLive,
	type ThreadRow,
	type ThreadSection,
	type ThreadUnit,
} from "@prismalens/contracts";

export type RowState = "ask" | "live" | "failed" | "new" | null;

/** The one state a row shows on its first line; null shows the age. */
export function rowState(t: ThreadRow): RowState {
	const live = isWorkflowLive(t.status);
	if (live && t.awaitingApprovalAt) return "ask";
	if (live) return "live";
	if (t.status === "failed" && t.unseen) return "failed";
	if (t.unseen) return "new";
	return null;
}

export const STATE_WORD: Record<Exclude<RowState, null>, string> = {
	ask: "Approve",
	live: "Working",
	failed: "Failed",
	new: "New",
};

/** The third line: the live step, the outcome, or why it failed; null drops it. */
export function rowLine(t: ThreadRow): string | null {
	if (isWorkflowLive(t.status)) return t.latestText;
	if (t.status === "failed") return t.error?.trim() || "Run failed";
	if (t.status === "cancelled") return "Stopped by you";
	if (t.kind === "investigation" && t.incidentId) {
		const cause = t.rootCause?.trim();
		return cause ? `Likely cause: ${cause}` : "No cause named";
	}
	return t.latestText ? `Answer: ${t.latestText}` : null;
}

/** The first line's context: the project or service, else nothing. */
export function rowContext(t: ThreadRow): string | null {
	return t.projectName ?? t.serviceName ?? null;
}

export type ThreadLink =
	| {
			to: "/incidents/$id/conversation";
			params: { id: string };
			search: { investigation: string };
	  }
	| { to: "/schedules/$id/runs/$runId"; params: { id: string; runId: string } }
	| { to: "/threads/$id"; params: { id: string } };

export function threadLink(
	t: Pick<ThreadRow, "id" | "incidentId" | "scheduleId">,
): ThreadLink {
	if (t.incidentId)
		return {
			to: "/incidents/$id/conversation",
			params: { id: t.incidentId },
			search: { investigation: t.id },
		};
	if (t.scheduleId)
		return {
			to: "/schedules/$id/runs/$runId",
			params: { id: t.scheduleId, runId: t.id },
		};
	return { to: "/threads/$id", params: { id: t.id } };
}

const SEVERITY_VAR: Record<string, string> = {
	critical: "var(--danger)",
	high: "var(--sev-high)",
	medium: "var(--warn)",
	low: "var(--sev-low)",
	info: "var(--text-3)",
};

/** The stripe and chip colour: the incident's severity tone. */
export function severityColor(severity: string): string {
	return SEVERITY_VAR[severity] ?? "var(--text-3)";
}

const SEVERITY_WORD: Record<string, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
	info: "Info",
};
export const severityWord = (s: string) => SEVERITY_WORD[s] ?? s;

/**
 * What the announcer reads when a thread changes section between two reads of
 * the list. A thread seen for the first time is not news.
 */
export function announcements(
	before: ReadonlyMap<string, ThreadSection>,
	units: ThreadUnit[],
): string[] {
	const said: string[] = [];
	for (const u of units)
		for (const t of u.threads) {
			const was = before.get(t.id);
			if (!was || was === t.section) continue;
			const title = t.title?.trim() || "A thread";
			if (t.section === "needs")
				said.push(
					`${title}: ${rowState(t) === "ask" ? "waiting for you" : "needs you"}`,
				);
			else if (t.section === "settled") said.push(`${title}: settled`);
		}
	return said;
}

export function sectionsOf(units: ThreadUnit[]): Map<string, ThreadSection> {
	const map = new Map<string, ThreadSection>();
	for (const u of units) for (const t of u.threads) map.set(t.id, t.section);
	return map;
}
