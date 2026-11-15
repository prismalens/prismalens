// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	detailsRows,
	type IncidentDetails,
	type ThreadDetails,
} from "./details-registry";

describe("detailsRows for thread", () => {
	// 24043161c: the box has fixed slots; the agent and model are the composer's.
	it("returns ids in slot order branch, changes, pr, place, machine, startedBy, subagents, started, schedule, watching for a thread fixture with every field", () => {
		const fullThread: ThreadDetails = {
			kind: "thread",
			machine: "workstation-1",
			place: { name: "acme/orders", path: "/work/orders" },
			branch: "feat/kit",
			changes: { added: 15, removed: 3 },
			pr: { number: 42, word: "Passing", tone: "passing" },
			startedBy: { title: "Checkout 502s", via: "agent" },
			started: 3,
			running: 2,
			watching: "app.log",
			schedule: "0 0 * * *",
		};
		const rows = detailsRows(fullThread);
		expect(rows.map((r) => [r.id, r.group])).toEqual([
			["branch", "work"],
			["changes", "work"],
			["pr", "work"],
			["place", "place"],
			["machine", "place"],
			["startedBy", "lineage"],
			["subagents", "lineage"],
			["started", "lineage"],
			["schedule", "lineage"],
			["watching", "lineage"],
		]);
	});

	// 24043161c: an absent fact keeps its row as a quiet line, so the box holds still.
	it("returns quiet branch, changes, pr and place rows for an empty thread", () => {
		const rows = detailsRows({ kind: "thread" });
		expect(rows.map((r) => [r.id, r.label, r.quiet])).toEqual([
			["branch", "No branch", true],
			["changes", "No changes", true],
			["pr", "No pull request", true],
			["place", "No folder", true],
		]);
	});

	// 98d40f16c colours a passing PR's row green (ok).
	it("gives row tone danger for pr tone failing, and ok for passing", () => {
		const failingThread: ThreadDetails = {
			kind: "thread",
			pr: { number: 10, word: "Failing", tone: "failing" },
		};
		const passingThread: ThreadDetails = {
			kind: "thread",
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
