// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread list's rules (#1020): which section a thread sits in, and how
 * an incident's threads page as one unit. Pure, so the rules have tests.
 */
import { isWorkflowLive, type ThreadSection } from "@prismalens/contracts";

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

export function threadSection(
	t: SectionFacts,
	now: Date,
	settleAfterDays: number,
): ThreadSection {
	const live = isWorkflowLive(t.status);
	if ((live && t.awaitingApprovalAt) || isUnseen(t)) return "needs";
	if (live) return "active";
	// Settling holds only until new activity: anything later returns it to Active.
	if (t.settledAt && t.settledAt >= t.lastActivityAt) return "settled";
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
 * One unit per thread with no incident, one per incident for the rest. A unit
 * takes its best section, so one thread needing you lifts its whole block.
 */
export function unitsOf<T extends Sectioned>(rows: T[]): Unit<T>[] {
	const blocks = new Map<string, Unit<T>>();
	const units: Unit<T>[] = [];
	for (const row of rows) {
		const block = row.incidentId ? blocks.get(row.incidentId) : undefined;
		if (block) {
			block.threads.push(row);
			if (RANK[row.section] < RANK[block.section]) block.section = row.section;
			if (row.lastActivityAt > block.lastActivityAt)
				block.lastActivityAt = row.lastActivityAt;
			continue;
		}
		const unit: Unit<T> = {
			section: row.section,
			incidentId: row.incidentId,
			threads: [row],
			lastActivityAt: row.lastActivityAt,
		};
		units.push(unit);
		if (row.incidentId) blocks.set(row.incidentId, unit);
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
