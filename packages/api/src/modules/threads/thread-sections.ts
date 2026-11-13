// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread list's rules (#1020): which section a thread sits in, and how
 * an incident's threads page as one unit. Pure, so the rules have tests.
 */
import {
	isNeedsYou,
	isWorkflowLive,
	type ThreadSection,
	type ThreadStatus,
} from "@prismalens/contracts";

const DAY_MS = 86_400_000;
const RANK: Record<ThreadSection, number> = { needs: 0, active: 1, settled: 2 };

export interface SectionFacts {
	status: string;
	incidentId: string | null;
	awaitingApprovalAt: Date | null;
	lastTurnOutcome: string | null;
	lastVisitedAt: Date | null;
	settledAt: Date | null;
	lastActivityAt: Date;
	/** Off: a usage limit waits for the user, so a Limited thread needs them. */
	autoResume?: boolean | null;
	/** The thread's incident, when it has one. */
	incident: { status: string; closedAt: Date | null } | null;
}

/** An answer, a report or a failure landed after the operator last opened the thread. */
export function isUnseen(t: SectionFacts): boolean {
	if (isWorkflowLive(t.status)) return false;
	if (t.status !== "completed" && t.status !== "failed") return false;
	if (t.lastTurnOutcome === "stopped") return false;
	// Settling reads it too; held apart from lastVisitedAt so Undo restores the exact state.
	for (const seen of [t.lastVisitedAt, t.settledAt])
		if (seen && seen >= t.lastActivityAt) return false;
	return true;
}

/**
 * With its status (#1101 category 2), a thread needs you while it asks, is stopped
 * or failed unseen; a finished thread is Done, not needs-you, even unseen.
 */
export function threadSection(
	t: SectionFacts,
	now: Date,
	settleAfterDays: number,
	status?: ThreadStatus,
): ThreadSection {
	const live = isWorkflowLive(t.status);
	if (status) {
		// Limited resolves itself while auto-resume is on; it needs you only once that is off.
		const waitsOnItself = status === "limited" && t.autoResume !== false;
		if (
			isNeedsYou(status) &&
			!waitsOnItself &&
			(status !== "failed" || isUnseen(t))
		)
			return "needs";
	} else if ((live && t.awaitingApprovalAt) || isUnseen(t)) return "needs";
	if (live) return "active";
	// Settling holds only until new activity: anything later returns it to Active.
	if (t.settledAt && t.settledAt >= t.lastActivityAt) return "settled";
	// Unread work never settles by quiet days alone: it waits to be read (#1101 category 2).
	if (status && isUnseen(t)) return "active";
	if (t.incident) {
		const closedAt = t.incident.closedAt;
		return t.incident.status === "closed" &&
			closedAt &&
			closedAt >= t.lastActivityAt
			? "settled"
			: "active";
	}
	return now.getTime() - t.lastActivityAt.getTime() >= settleAfterDays * DAY_MS
		? "settled"
		: "active";
}

export interface Sectioned {
	id: string;
	incidentId: string | null;
	section: ThreadSection;
	lastActivityAt: Date;
}

export interface Unit<T extends Sectioned> {
	section: ThreadSection;
	incidentId: string | null;
	threads: T[];
	lastActivityAt: Date;
}

/**
 * One unit per thread with no incident and one per incident; threads an agent started are
 * flat siblings with units of their own (#1101 cat 10). A unit takes its best section, so
 * one thread needing you lifts its whole incident.
 */
export function unitsOf<T extends Sectioned>(rows: T[]): Unit<T>[] {
	const blocks = new Map<string, Unit<T>>();
	const units: Unit<T>[] = [];
	for (const row of rows) {
		const key = row.incidentId ? `i:${row.incidentId}` : null;
		let unit = key ? blocks.get(key) : undefined;
		if (!unit) {
			unit = {
				section: row.section,
				incidentId: row.incidentId,
				threads: [],
				lastActivityAt: row.lastActivityAt,
			};
			units.push(unit);
			if (key) blocks.set(key, unit);
		}
		unit.threads.push(row);
		if (RANK[row.section] < RANK[unit.section]) unit.section = row.section;
		if (row.lastActivityAt > unit.lastActivityAt)
			unit.lastActivityAt = row.lastActivityAt;
	}
	for (const u of units)
		u.threads.sort(
			(a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
		);
	return units.sort(
		(a, b) =>
			RANK[a.section] - RANK[b.section] ||
			b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
	);
}
