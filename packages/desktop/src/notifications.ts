// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Presence: the launcher polls the investigations list and raises one native
 * notification per investigation that has just finished. Pure diff, so the
 * poll cadence and the notification API stay out of the test.
 */

export type InvestigationStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface InvestigationSummary {
	id: string;
	summary: string | null;
	status: InvestigationStatus;
	incidentId?: string;
	/** `INC-n` in a notification; absent from an older backend. */
	incidentNumber?: number;
	/** Set while the agent waits on an Approve or Deny (#673 w21). */
	awaitingApprovalAt?: string | null;
}

export const FINISHED: ReadonlySet<InvestigationStatus> = new Set([
	"completed",
	"failed",
]);

export interface FinishedInvestigation {
	id: string;
	summary: string | null;
	status: "completed" | "failed";
	incidentId?: string;
}

/**
 * The investigations that were not finished at the last poll and are now.
 * An investigation first seen already finished is not announced: the app was
 * just opened, and that would replay history as news.
 */
export function newlyFinished(
	previous: ReadonlyMap<string, InvestigationStatus>,
	current: readonly InvestigationSummary[],
): FinishedInvestigation[] {
	const out: FinishedInvestigation[] = [];
	for (const inv of current) {
		if (!FINISHED.has(inv.status)) continue;
		const before = previous.get(inv.id);
		if (before === undefined || FINISHED.has(before)) continue;
		out.push({
			id: inv.id,
			summary: inv.summary,
			status: inv.status as "completed" | "failed",
			incidentId: inv.incidentId,
		});
	}
	return out;
}

export function snapshot(
	current: readonly InvestigationSummary[],
): Map<string, InvestigationStatus> {
	return new Map(current.map((i) => [i.id, i.status]));
}

export function notificationText(inv: FinishedInvestigation): {
	title: string;
	body: string;
} {
	return inv.status === "completed"
		? { title: "Investigation finished", body: inv.summary ?? "" }
		: { title: "Investigation failed", body: inv.summary ?? "" };
}

export interface Ask {
	id: string;
	incidentId?: string;
	incidentNumber?: number;
	since: string;
}

/**
 * The runs that started waiting on an approval since the last poll, keyed by
 * when they started, so a second ask on the same run notifies again (#673 w21).
 * On the first poll nothing is announced, as with finished runs.
 */
export function newlyAsking(
	previous: ReadonlyMap<string, string>,
	current: readonly InvestigationSummary[],
): Ask[] {
	const out: Ask[] = [];
	for (const inv of current) {
		const since = inv.awaitingApprovalAt;
		if (!since || previous.get(inv.id) === since) continue;
		out.push({
			id: inv.id,
			incidentId: inv.incidentId,
			incidentNumber: inv.incidentNumber,
			since,
		});
	}
	return out;
}

/** Each waiting run by when it started waiting. */
export function askSnapshot(
	current: readonly InvestigationSummary[],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const i of current)
		if (i.awaitingApprovalAt) out.set(i.id, i.awaitingApprovalAt);
	return out;
}

export function askNotificationText(ask: Ask): { title: string; body: string } {
	const which =
		ask.incidentNumber !== undefined ? `INC-${ask.incidentNumber}` : "A run";
	return {
		title: `${which} is waiting for your approval`,
		body: "The agent asked before a tool call. Approve or deny it in the conversation; no answer in 10 minutes denies it.",
	};
}

/** How many investigations are queued or running, for the tray. */
export function runningCount(current: readonly InvestigationSummary[]): number {
	return current.filter((i) => i.status === "pending" || i.status === "running")
		.length;
}

/** Where a run's notification opens: the run in its incident's conversation. */
export function runPath(run: { id: string; incidentId?: string }): string {
	return run.incidentId
		? `/incidents/${run.incidentId}/conversation?investigation=${run.id}`
		: `/investigations/${run.id}`;
}

/** The part of an Electron Notification `holdUntilClicked` uses. */
export interface Clickable {
	once(event: "click", listener: () => void): unknown;
}

/**
 * Windows drops the click of a notification whose object was garbage collected (#831),
 * so each is held until clicked; past `cap`, the oldest is let go.
 */
export function holdUntilClicked<N extends Clickable>(
	held: Set<N>,
	n: N,
	cap = 25,
): void {
	held.add(n);
	n.once("click", () => held.delete(n));
	for (const old of held) {
		if (held.size <= cap) break;
		held.delete(old);
	}
}

/** The part of a BrowserWindow `reveal` uses. */
export interface Revealable {
	isMinimized(): boolean;
	restore(): void;
	show(): void;
	focus(): void;
}

/** A minimized window needs restore() before focus() brings it up. */
export function reveal(win: Revealable): void {
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}
