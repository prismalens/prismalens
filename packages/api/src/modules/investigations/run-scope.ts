// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSubjectKind } from "@prismalens/contracts";

export interface ScopedRun {
	id?: string;
	incidentId: string | null;
	scheduleId?: string | null;
	serviceId?: string | null;
	repositoryId?: string | null;
}

/**
 * What a thread is about, from its ids (#1020). A finding can link a schedule's run to an
 * incident later, so the incident wins; a service id alone is a service thread only
 * when no schedule admitted the run.
 */
export function threadSubject(run: ScopedRun): ThreadSubjectKind {
	if (run.incidentId) return "incident";
	if (run.scheduleId) return "schedule";
	if (run.repositoryId) return "project";
	if (run.serviceId) return "service";
	return "none";
}

/**
 * The runs a run shares a thread list and an admission lock with: its incident's, else its
 * schedule's (#979). A project, service or no-subject thread is its own unit (#1020).
 */
export type RunScope =
	| { incidentId: string }
	| { scheduleId: string }
	| { id: string };

/** `incidentId: null` in a Prisma filter is `IS NULL`, which matches every unlinked run (#979). */
export function runScope(run: ScopedRun): RunScope {
	if (run.incidentId) return { incidentId: run.incidentId };
	if (run.scheduleId) return { scheduleId: run.scheduleId };
	if (run.id) return { id: run.id };
	throw new Error("A run with no incident or schedule is scoped by its own id");
}

/** True when a new run on this subject must wait for the live one (one per incident or schedule). */
export function sharesAdmission(run: ScopedRun): boolean {
	return !!run.incidentId || !!run.scheduleId;
}

/** One key per thread list, for grouping rows in memory. */
export function runScopeKey(run: ScopedRun): string {
	if (run.incidentId) return run.incidentId;
	if (run.scheduleId) return `schedule:${run.scheduleId}`;
	return `run:${run.id ?? ""}`;
}
