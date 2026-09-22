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
	title: string;
	status: InvestigationStatus;
	incidentId?: string;
}

export const FINISHED: ReadonlySet<InvestigationStatus> = new Set([
	"completed",
	"failed",
]);

export interface FinishedInvestigation {
	id: string;
	title: string;
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
			title: inv.title,
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
		? { title: "Investigation finished", body: inv.title }
		: { title: "Investigation failed", body: inv.title };
}
