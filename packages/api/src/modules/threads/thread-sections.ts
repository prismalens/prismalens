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
		if (isNeedsYou(status) && (status !== "failed" || isUnseen(t)))
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
	/** A thread tree's root (#1024): the tree pages as one block. */
	rootId?: string | null;
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
 * One unit per thread with no incident, one per incident, and one per thread tree (#1024),
 * an incident's tree joining its incident's block. A unit takes its best section, so one
 * thread needing you lifts its whole block.
 */
export function unitsOf<T extends Sectioned>(rows: T[]): Unit<T>[] {
	const blocks = new Map<string, Unit<T>>();
	let units: Unit<T>[] = [];
	const keysOf = (row: T) => [
		...(row.rootId ? [`t:${row.rootId}`] : []),
		...(row.incidentId ? [`i:${row.incidentId}`] : []),
	];
	for (const row of rows) {
		const keys = keysOf(row);
		const found = [...new Set(keys.flatMap((k) => blocks.get(k) ?? []))];
		let unit = found[0];
		if (!unit) {
			unit = {
				section: row.section,
				incidentId: row.incidentId,
				threads: [],
				lastActivityAt: row.lastActivityAt,
			};
			units.push(unit);
		}
		// A row can join two blocks met apart (a tree's child before its incident's other threads).
		for (const other of found.slice(1)) {
			unit.threads.push(...other.threads);
			if (RANK[other.section] < RANK[unit.section])
				unit.section = other.section;
			if (other.lastActivityAt > unit.lastActivityAt)
				unit.lastActivityAt = other.lastActivityAt;
			unit.incidentId ??= other.incidentId;
			for (const [k, b] of blocks) if (b === other) blocks.set(k, unit);
			units = units.filter((u) => u !== other);
		}
		unit.threads.push(row);
		unit.incidentId ??= row.incidentId;
		if (RANK[row.section] < RANK[unit.section]) unit.section = row.section;
		if (row.lastActivityAt > unit.lastActivityAt)
			unit.lastActivityAt = row.lastActivityAt;
		for (const k of keys) blocks.set(k, unit);
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
