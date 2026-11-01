// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Cron } from "croner";

/** A calendar schedule in a time zone, or an elapsed interval that DST never touches (#979). */
export type Recurrence =
	| { type: "cron"; expr: string; timezone: string }
	| { type: "interval"; everyMinutes: number; anchorAt: Date };

export type CronShape = "fixed" | "repeating";

export const MIN_GAP_MINUTES = 15;
export const DUE_WALK_BOUND = 5000;

const cronOf = (expr: string, timezone?: string) =>
	new Cron(expr, { timezone, paused: true });

/** Fixed: one minute and one hour. A repeated autumn hour runs once only for this shape (croner's pattern docs). */
export function cronShape(expr: string): CronShape {
	const [minute = "", hour = ""] = expr.trim().split(/\s+/);
	return /^\d+$/.test(minute) && /^\d+$/.test(hour) ? "fixed" : "repeating";
}

/** Why the recurrence can't be saved, or null. */
export function recurrenceError(r: Recurrence): string | null {
	if (r.type === "interval") {
		return Number.isInteger(r.everyMinutes) && r.everyMinutes >= MIN_GAP_MINUTES
			? null
			: `Runs must be at least ${MIN_GAP_MINUTES} minutes apart.`;
	}
	if (r.expr.trim().split(/\s+/).length !== 5)
		return "A cron expression has five fields: minute, hour, day of month, month, day of week.";
	let cron: Cron;
	try {
		cron = cronOf(r.expr, r.timezone);
	} catch (error) {
		return `Not a cron expression PrismaLens can read: ${(error as Error).message}`;
	}
	const slots = cron.nextRuns(200);
	if (slots.length === 0) return "This cron expression never runs.";
	for (let i = 1; i < slots.length; i++) {
		if (
			(slots[i] as Date).getTime() - (slots[i - 1] as Date).getTime() <
			MIN_GAP_MINUTES * 60_000
		)
			return `Runs must be at least ${MIN_GAP_MINUTES} minutes apart.`;
	}
	return null;
}

const crons = new WeakMap<Recurrence, Cron>();

/** The first slot strictly after `after`. */
function nextAfter(r: Recurrence, after: Date): Date | null {
	if (r.type === "interval") {
		const step = r.everyMinutes * 60_000;
		const k = Math.floor((after.getTime() - r.anchorAt.getTime()) / step) + 1;
		return new Date(r.anchorAt.getTime() + Math.max(k, 0) * step);
	}
	let cron = crons.get(r);
	if (!cron) {
		cron = cronOf(r.expr, r.timezone);
		crons.set(r, cron);
	}
	return cron.nextRun(after);
}

/** The first slot at or after `at`; croner resolves to whole seconds, so a slot equal to `at` counts. */
export function firstSlotAtOrAfter(r: Recurrence, at: Date): Date | null {
	return nextAfter(r, new Date(at.getTime() - 1));
}

export function nextSlots(r: Recurrence, after: Date, n: number): Date[] {
	const out: Date[] = [];
	let cursor = after;
	while (out.length < n) {
		const next = nextAfter(r, cursor);
		if (!next) break;
		out.push(next);
		cursor = next;
	}
	return out;
}

export interface DueSlots {
	/** The latest slot at or before now, or null when none is due or the backlog overflowed. */
	candidate: Date | null;
	/** Due slots walked, the candidate included. */
	count: number;
	overflow: boolean;
	/** The first slot after now: the schedule's next cursor. */
	next: Date;
}

export interface DueOptions {
	bound?: number;
	/** Past the bound, only slots this recent can still run, so only they are walked (adversary OBJ-007). */
	windowMs?: number;
}

/** Walks forward from the stored cursor so no due slot is skipped (#979, adversary OBJ-007). */
export function dueSlots(
	r: Recurrence,
	cursor: Date,
	now: Date,
	{ bound = DUE_WALK_BOUND, windowMs = 0 }: DueOptions = {},
): DueSlots {
	let slot: Date | null = cursor;
	let candidate: Date | null = null;
	let count = 0;
	while (slot && slot.getTime() <= now.getTime()) {
		if (count === bound) return recentSlots(r, now, windowMs, count);
		candidate = slot;
		count++;
		slot = nextAfter(r, slot);
	}
	return { candidate, count, overflow: false, next: slot ?? NEVER };
}

const NEVER = new Date(8.64e15);

/** The latest slot inside [now - window, now], walked inclusively; older history is only counted. */
function recentSlots(
	r: Recurrence,
	now: Date,
	windowMs: number,
	counted: number,
): DueSlots {
	let slot = firstSlotAtOrAfter(r, new Date(now.getTime() - windowMs));
	let candidate: Date | null = null;
	while (slot && slot.getTime() <= now.getTime()) {
		candidate = slot;
		slot = nextAfter(r, slot);
	}
	return { candidate, count: counted, overflow: true, next: slot ?? NEVER };
}
