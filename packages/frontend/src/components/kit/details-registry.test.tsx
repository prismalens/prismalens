// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	detailsRows,
	type IncidentDetails,
	type ThreadDetails,
} from "./details-registry";

describe("detailsRows for thread", () => {
	// 24043161c: the box has fixed slots; the agent and model are the composer's.
	// 9900b785c: who started it is the sidebar row's and the header's, never the box's.
	it("returns ids in slot order branch, changes, pr, place, machine, subagents, started, schedule, watching for a thread fixture with every field", () => {
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
			["started", "tail"],
			["schedule", "tail"],
			["watching", "tail"],
		]);
	});

	// The follow-up to 24043161c: an empty work slot says so once, not once per missing fact.
	it("returns one quiet line for a thread with no code and no folder", () => {
		const rows = detailsRows({ kind: "thread" });
		expect(rows.map((r) => [r.id, r.label, r.quiet])).toEqual([
			["work", "No code or folder yet", true],
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

	it("formats started row with running count and attaches open.started callback (#1176 D16)", () => {
		const onStarted = vi.fn();
		const thread: ThreadDetails = {
			kind: "thread",
			started: 5,
			running: 2,
			open: { started: onStarted },
		};

		const startedRow = detailsRows(thread).find((r) => r.id === "started");
		expect(startedRow?.label).toBe("Started");
		expect(startedRow?.onOpen).toBe(onStarted);
	});

	it("renders detached tip row with mono, hint, and short sha (#1176)", () => {
		const thread: ThreadDetails = {
			kind: "thread",
			detached: "fea75d9",
			place: { name: "repo", path: "/path/to/repo" },
		};

		const rows = detailsRows(thread);
		const branchRow = rows.find((r) => r.id === "branch");
		expect(branchRow?.mono).toBe(true);
		expect(branchRow?.quiet).toBeUndefined();

		// Detached tip counts as code work so quiet row 'No code or folder yet' is suppressed
		expect(rows.some((r) => r.id === "work")).toBe(false);
	});

	it("names the branch a detached run copy was cut from", () => {
		const thread: ThreadDetails = {
			kind: "thread",
			detached: "9469cc2",
			from: "master",
			place: { name: "repo" },
		};

		const branchRow = detailsRows(thread).find((r) => r.id === "branch");

		expect(renderToStaticMarkup(<>{branchRow?.label}</>)).toContain(
			">Run copy of master at 9469cc2</button>",
		);
	});

	it("keeps the plain Detached words when the source branch is unknown", () => {
		const thread: ThreadDetails = {
			kind: "thread",
			detached: "9469cc2",
			place: { name: "repo" },
		};

		const branchRow = detailsRows(thread).find((r) => r.id === "branch");

		expect(renderToStaticMarkup(<>{branchRow?.label}</>)).toContain(
			">Detached at 9469cc2</button>",
		);
	});

	it("attaches folder open-in node as value of place row (#1176)", () => {
		const fakeFolderEl = (
			<button type="button" data-testid="folder-split-btn">
				Open
			</button>
		);
		const thread: ThreadDetails = {
			kind: "thread",
			place: { name: "repo", path: "/path/to/repo" },
			folder: fakeFolderEl,
		};

		const rows = detailsRows(thread);
		const placeRow = rows.find((r) => r.id === "place");
		expect(placeRow?.value).toBe(fakeFolderEl);
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

describe("the detached branch row", () => {
	it("reaches the full label and the push guidance from the keyboard, when a long branch cuts the visible text", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const from = "feature/a-very-long-branch-name-that-the-row-cuts";
		const row = detailsRows({
			kind: "thread",
			detached: "9469cc2",
			from,
			place: { name: "repo" },
		}).find((r) => r.id === "branch");
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		act(() => root.render(<TooltipProvider>{row?.label}</TooltipProvider>));

		const label = host.querySelector<HTMLElement>(
			'[data-testid="details-detached"]',
		);
		expect(label?.tagName).toBe("BUTTON");
		act(() => label?.focus());

		const hint = document.querySelector('[data-testid="hint"]')?.textContent;
		expect(hint).toContain(`Run copy of ${from} at 9469cc2`);
		expect(hint).toContain(
			"No branch yet. Commits here can't be pushed until one is made.",
		);
		act(() => root.unmount());
		host.remove();
	});
});
