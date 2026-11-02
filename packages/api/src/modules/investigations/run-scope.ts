// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The runs a run shares a thread list with: its incident's, else its schedule's (#979). */
export type RunScope = { incidentId: string } | { scheduleId: string };

/**
 * `incidentId: null` in a Prisma filter is `IS NULL`, which matches every unlinked run, so a
 * run with no incident is scoped by its schedule instead (#979).
 */
export function runScope(run: {
	incidentId: string | null;
	scheduleId?: string | null;
}): RunScope {
	if (run.incidentId) return { incidentId: run.incidentId };
	if (run.scheduleId) return { scheduleId: run.scheduleId };
	throw new Error("A run with no incident must name its schedule");
}

/** One key per thread list, for grouping rows in memory. */
export function runScopeKey(run: {
	incidentId: string | null;
	scheduleId?: string | null;
}): string {
	return run.incidentId ?? `schedule:${run.scheduleId}`;
}
