// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, WaitingOn } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	rollUpLine,
	statusReason,
	waitingLine,
} from "./thread-status.js";

const fixedClock = (iso: string) => `fixed(${iso})`;

describe("waitingLine (#1101 category 2)", () => {
	it("thread kind", () => {
		const w1: WaitingOn = {
			kind: "thread",
			id: "t1",
			title: "Fix 502s",
			more: 0,
		};
		expect(waitingLine(w1, fixedClock)).toBe("Waiting on Fix 502s");

		const w2: WaitingOn = {
			kind: "thread",
			id: "t2",
			title: "Fix 502s",
			more: 2,
		};
		expect(waitingLine(w2, fixedClock)).toBe("Waiting on Fix 502s and 2 more");

		const w3: WaitingOn = {
			kind: "thread",
			id: "t3",
			title: null,
			more: 0,
		};
		expect(waitingLine(w3, fixedClock)).toBe("Waiting on another thread");
	});

	it("pr kind", () => {
		const wChecks: WaitingOn = {
			kind: "pr",
			number: 331,
			until: "checks_done",
		};
		expect(waitingLine(wChecks, fixedClock)).toBe("Watching PR #331 checks");

		const wReview: WaitingOn = {
			kind: "pr",
			number: 331,
			until: "review",
		};
		expect(waitingLine(wReview, fixedClock)).toBe("Watching PR #331 for review");

		const wMerged: WaitingOn = {
			kind: "pr",
			number: 331,
			until: "merged",
		};
		expect(waitingLine(wMerged, fixedClock)).toBe("Watching PR #331 until merged");

		const wNoNum: WaitingOn = {
			kind: "pr",
			number: null,
			until: "checks_done",
		};
		expect(waitingLine(wNoNum, fixedClock)).toBe("Watching a PR checks");
	});

	it("cron kind", () => {
		const wCronWithNext: WaitingOn = {
			kind: "cron",
			schedule: "*/30 * * * *",
			nextAt: "2026-11-12T14:10:00.000Z",
		};
		expect(waitingLine(wCronWithNext, fixedClock)).toBe(
			"Every 30 minutes, next fixed(2026-11-12T14:10:00.000Z)",
		);

		const wCronNoNext: WaitingOn = {
			kind: "cron",
			schedule: "*/30 * * * *",
			nextAt: null,
		};
		expect(waitingLine(wCronNoNext, fixedClock)).toBe("Every 30 minutes");
	});

	it("wake kind", () => {
		const wWake: WaitingOn = {
			kind: "wake",
			at: "2026-11-12T15:40:00.000Z",
		};
		expect(waitingLine(wWake, fixedClock)).toBe(
			"Wake at fixed(2026-11-12T15:40:00.000Z)",
		);
	});
});

describe("statusReason (#1101 category 2)", () => {
	it("statusReason for working quiet ('Working, quiet for 12 min')", () => {
		const now = Date.parse("2026-11-12T12:00:00.000Z");
		const quietSince = new Date(now - 12 * 60_000).toISOString();
		const thread = {} as ThreadRow;
		const reason = statusReason(
			thread,
			{ status: "working", quietSince },
			now,
			fixedClock,
		);
		expect(reason).toBe("Working, quiet for 12 min");
	});
});

describe("rollUpLine (#1101 category 2)", () => {
	it("rollUpLine(['approval','question','working','waiting','done','done']) === '2 need you, 1 working, 1 waiting, 2 done'", () => {
		const statuses = [
			"approval",
			"question",
			"working",
			"waiting",
			"done",
			"done",
		] as const;
		expect(rollUpLine(statuses)).toBe(
			"2 need you, 1 working, 1 waiting, 2 done",
		);
	});
});
