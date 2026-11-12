// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { TICK_OUTCOMES, type ScheduleTick } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { aboutText, limitLine, tickLine } from "./tick-copy";

const tick = (over: Partial<ScheduleTick>): ScheduleTick => ({
	id: "t",
	scheduledFor: "2026-10-30T13:00:00.000Z",
	decidedAt: "2026-10-30T14:34:00.000Z",
	outcome: "started",
	reason: null,
	missedCount: 0,
	missedOverflow: false,
	run: null,
	...over,
});
const run = (over: Partial<NonNullable<ScheduleTick["run"]>> = {}) => ({
	id: "r",
	status: "completed" as const,
	summary: null,
	error: null,
	startedAt: null,
	completedAt: null,
	incidentId: null,
	incidentNumber: null,
	...over,
});
const fmt = (iso: string) => iso.slice(11, 16);

describe("tickLine (#979)", () => {
	it("has words for every outcome", () => {
		for (const outcome of TICK_OUTCOMES) {
			const line = tickLine(tick({ outcome, run: run() }), fmt);
			expect(line.text.length).toBeGreaterThan(5);
			expect(line.text).not.toMatch(/—|·/);
		}
	});

	it("says what a run found, and links its incident", () => {
		expect(tickLine(tick({ run: run() }), fmt)).toMatchObject({ tone: "ok", text: "Nothing wrong found" });
		expect(tickLine(tick({ run: run({ incidentId: "i", incidentNumber: 41 }) }), fmt)).toMatchObject({
			tone: "warn",
			text: "Found a likely cause: INC-41",
			link: { kind: "incident", id: "i", label: "Open INC-41" },
		});
		expect(tickLine(tick({ run: run({ status: "failed", error: "the agent stopped responding" }) }), fmt)).toMatchObject({
			tone: "bad",
			text: "Failed: the agent stopped responding",
		});
		expect(tickLine(tick({ run: run({ status: "running" }) }), fmt)).toMatchObject({ tone: "live", text: "Running now" });
	});

	it("says a late run ran after sleep, and when", () => {
		expect(tickLine(tick({ outcome: "late_started", reason: "asleep", run: run() }), fmt).text).toBe(
			"Ran late at 14:34 after sleep: nothing wrong found",
		);
		expect(tickLine(tick({ outcome: "missed_off", missedCount: 3 }), fmt).text).toBe(
			"Missed 3 runs: PrismaLens was off",
		);
	});
});

describe("tickLine status and words (#1101 category 22, cp1 L6a item 2)", () => {
	it("reads a run waiting on its agent's limit as Limited with its reset, even when its status says failed", () => {
		expect(
			tickLine(tick({ run: run({ status: "failed", error: "usage limit", limit: { resetsAt: "2026-10-30T16:45:00.000Z" } }) }), fmt),
		).toMatchObject({ tone: "warn", status: "limited", text: "Usage limit, resets 16:45", link: { kind: "run", id: "r" } });
		expect(tickLine(tick({ run: run({ status: "running", limit: { resetsAt: null } }) }), fmt)).toMatchObject({
			status: "limited",
			text: "Usage limit, reset time unknown",
		});
	});

	it("words a failed run with its own cause, else its answer's first line, never a pointer to the thread", () => {
		expect(tickLine(tick({ run: run({ status: "failed", error: "API key rejected\nstack trace" }) }), fmt)).toMatchObject({
			status: "failed",
			text: "Failed: API key rejected",
		});
		expect(tickLine(tick({ run: run({ status: "failed", summary: "\nThe deploy hook timed out" }) }), fmt)).toMatchObject({
			status: "failed",
			text: "Failed: The deploy hook timed out",
		});
		expect(tickLine(tick({ run: run({ status: "failed" }) }), fmt).text).toBe("Failed: the run stopped");
	});

	it("gives a finished run its answer's first line and the Done status", () => {
		expect(tickLine(tick({ run: run({ summary: "Checkout p99 is back under 200 ms.\nDetails follow." }) }), fmt)).toMatchObject({
			tone: "ok",
			status: "done",
			text: "Checkout p99 is back under 200 ms.",
		});
		expect(tickLine(tick({ run: run() }), fmt)).toMatchObject({ status: "done", text: "Nothing wrong found" });
	});

	it("maps the other outcomes into the closed set: working, waiting, done for a stop, idle for a miss", () => {
		expect(tickLine(tick({ run: run({ status: "running" }) }), fmt).status).toBe("working");
		expect(tickLine(tick({ run: run({ status: "pending" }) }), fmt).status).toBe("waiting");
		expect(tickLine(tick({ run: run({ status: "cancelled" }) }), fmt)).toMatchObject({ status: "done", text: "Stopped" });
		expect(tickLine(tick({ outcome: "missed_off", missedCount: 1 }), fmt).status).toBe("idle");
		expect(tickLine(tick({ outcome: "skipped_bindings_changed" }), fmt).status).toBe("blocked");
	});
});

describe("aboutText (#1020)", () => {
	it("names a service's check, a project, or no project", () => {
		expect(aboutText({ subject: "service", serviceName: "checkout", repositoryName: null })).toBe("Check checkout");
		expect(aboutText({ subject: "project", serviceName: "", repositoryName: "acme/shop" })).toBe("acme/shop");
		expect(aboutText({ subject: "none", serviceName: "", repositoryName: null })).toBe("No project");
	});
});

describe("limitLine (#1101)", () => {
	it("renders reset time when time is given, and unknown when null", () => {
		expect(limitLine("2026-10-30T16:45:00.000Z", fmt)).toBe(
			"Usage limit, resets 16:45",
		);
		expect(limitLine(null, fmt)).toBe("Usage limit, reset time unknown");
	});
});
