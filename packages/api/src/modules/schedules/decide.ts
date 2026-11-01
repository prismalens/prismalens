// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { MissedPolicy, TickOutcome } from "@prismalens/contracts";
import { type DueOptions, dueSlots, type Recurrence } from "./recurrence.js";

/** A stretch PrismaLens was not running checks: the machine slept, or PrismaLens was off. */
export interface Gap {
	kind: "asleep" | "off";
	from: Date;
	to: Date;
}

/** A slot this close to now is on time; the loop wakes every 30 s. */
export const ON_TIME_MS = 2 * 60_000;
/** How long an on-time run under "Skip it" may wait for a free slot. */
export const SKIP_START_WINDOW_MS = 15 * 60_000;

export interface ScheduleClock {
	recurrence: Recurrence;
	nextRunAt: Date;
	missedPolicy: MissedPolicy;
	catchUpMinutes: number;
}

export interface Decision {
	slot: Date;
	outcome: Extract<
		TickOutcome,
		"started" | "late_started" | "missed_asleep" | "missed_off" | "missed_late"
	>;
	gap: Gap["kind"] | null;
	/** Earlier due slots folded into this one; they never run. */
	missedCount: number;
	missedOverflow: boolean;
	/** The schedule's next cursor. */
	next: Date;
	/** A started run not claimed by then is cancelled as host-busy. */
	startBy: Date | null;
}

/** What one evaluation does with a schedule's due slots: at most one run, the rest counted (#979). */
export function decide(
	s: ScheduleClock,
	now: Date,
	gapAt: (at: Date) => Gap | null,
	options: Omit<DueOptions, "windowMs"> = {},
): Decision | null {
	const windowMs = s.catchUpMinutes * 60_000;
	const due = dueSlots(s.recurrence, s.nextRunAt, now, {
		...options,
		windowMs,
	});
	if (due.count === 0) return null;
	const missed = (slot: Date, missedCount: number): Decision => {
		const gap = gapAt(slot)?.kind ?? null;
		return {
			slot,
			outcome: gap ? `missed_${gap}` : "missed_late",
			gap,
			missedCount,
			missedOverflow: due.overflow,
			next: due.next,
			startBy: null,
		};
	};
	if (!due.candidate) return missed(s.nextRunAt, due.count);

	const slot = due.candidate;
	const earlier = due.overflow ? due.count : due.count - 1;
	const late = now.getTime() - slot.getTime();
	if (late <= ON_TIME_MS) {
		const wait =
			s.missedPolicy === "run_once" ? windowMs : SKIP_START_WINDOW_MS;
		return {
			slot,
			outcome: "started",
			gap: null,
			missedCount: earlier,
			missedOverflow: due.overflow,
			next: due.next,
			startBy: new Date(slot.getTime() + wait),
		};
	}
	if (s.missedPolicy === "run_once" && late <= windowMs) {
		return {
			slot,
			outcome: "late_started",
			gap: gapAt(slot)?.kind ?? null,
			missedCount: earlier,
			missedOverflow: due.overflow,
			next: due.next,
			startBy: new Date(slot.getTime() + windowMs),
		};
	}
	return missed(slot, earlier + 1);
}
