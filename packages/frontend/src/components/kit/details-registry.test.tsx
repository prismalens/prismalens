// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	detailsRows,
	type IncidentDetails,
	type ThreadDetails,
} from "./details-registry";

describe("detailsRows for thread", () => {
	it("returns ids in exact order agent, machine, branch, changes, pr, parent, children, watching, schedule, context for a thread fixture with every field", () => {
		const fullThread: ThreadDetails = {
			kind: "thread",
			agent: { id: "claude-code", name: "Claude Code", model: "Opus 5.5" },
			machine: "workstation-1",
			branch: "feat/kit",
			changes: { added: 15, removed: 3 },
			pr: { number: 42, word: "Passing", tone: "passing" },
			parent: "parent-id",
			children: { count: 2, working: 1 },
			watching: "app.log",
			schedule: "0 0 * * *",
			context: 45,
		};
		const rows = detailsRows(fullThread);
		expect(rows.map((r) => r.id)).toEqual([
			"agent",
			"machine",
			"branch",
			"changes",
			"pr",
			"parent",
			"children",
			"watching",
			"schedule",
			"context",
		]);
	});

	it("returns ['agent'] for a fixture with only agent", () => {
		const minimalThread: ThreadDetails = {
			kind: "thread",
			agent: { id: "claude-code", name: "Claude Code" },
		};
		const rows = detailsRows(minimalThread);
		expect(rows.map((r) => r.id)).toEqual(["agent"]);
	});

	// 98d40f16c colours a passing PR's row green (ok).
	it("gives row tone danger for pr tone failing, and ok for passing", () => {
		const failingThread: ThreadDetails = {
			kind: "thread",
			agent: { id: "claude-code", name: "Claude Code" },
			pr: { number: 10, word: "Failing", tone: "failing" },
		};
		const passingThread: ThreadDetails = {
			kind: "thread",
			agent: { id: "claude-code", name: "Claude Code" },
			pr: { number: 10, word: "Passing", tone: "passing" },
		};

		const failingRow = detailsRows(failingThread).find((r) => r.id === "pr");
		const passingRow = detailsRows(passingThread).find((r) => r.id === "pr");

		expect(failingRow?.tone).toBe("danger");
		expect(passingRow?.tone).toBe("ok");
	});

	it("sets open.diff as the changes row onOpen", () => {
		const onDiff = vi.fn();
		const thread: ThreadDetails = {
			kind: "thread",
			agent: { id: "claude-code", name: "Claude Code" },
			changes: { added: 5, removed: 1 },
			open: { diff: onDiff },
		};

		const changesRow = detailsRows(thread).find((r) => r.id === "changes");
		expect(changesRow?.onOpen).toBe(onDiff);
	});
});

describe("detailsRows for incident", () => {
	it("returns ids severity, cause, next, alert, pr, cause row with lines: 2, severity tinted by its own tone and a firing alert left untinted", () => {
		const incident: IncidentDetails = {
			kind: "incident",
			severity: { word: "High", tone: "sev-high" },
			cause: "Connection pool exhausted",
			next: "pl doctor",
			alert: { name: "HighLatency", firing: true },
			pr: { number: 88, word: "Passing", tone: "passing" },
		};

		const rows = detailsRows(incident);
		expect(rows.map((r) => r.id)).toEqual([
			"severity",
			"cause",
			"next",
			"alert",
			"pr",
		]);

		const causeRow = rows.find((r) => r.id === "cause");
		expect(causeRow?.lines).toBe(2);

		expect(rows.find((r) => r.id === "severity")?.tone).toBe("sev-high");
		// Only needs-you and failed carry colour; the word "Firing" says it (sheet §9.1).
		expect(rows.find((r) => r.id === "alert")?.tone).toBeUndefined();
	});
});
