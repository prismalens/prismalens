// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { ListNode } from "./thread-list.js";
import {
	formatFilter,
	nodeMatches,
	parseFilter,
} from "./thread-filter.js";

const makeNode = (overThread: Partial<ThreadRow> = {}, overNode: Partial<ListNode> = {}): ListNode => {
	const thread = {
		id: "t-1",
		title: "flaky test fix in checkout",
		status: "completed",
		kind: "chat",
		origin: "local",
		schemaVersion: 1,
		createdAt: "2026-11-12T10:00:00.000Z",
		updatedAt: "2026-11-12T10:00:00.000Z",
		lastActivityAt: "2026-11-12T10:00:00.000Z",
		lastVisitedAt: "2026-11-12T10:00:00.000Z",
		settledAt: null,
		unseen: false,
		latestText: null,
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		section: "active",
		pinnedAt: "2026-11-12T10:00:00.000Z",
		pr: {
			number: 42,
			tone: "failing",
		},
		...overThread,
	} as ThreadRow;

	return {
		id: thread.id,
		thread,
		info: { status: "waiting" },
		at: Date.parse(thread.lastActivityAt),
		children: [],
		rolled: null,
		unit: { section: "active", incident: null, threads: [thread] },
		parentTitle: "checkout service",
		...overNode,
	};
};

describe("thread-filter (#1101 category 1 item 7)", () => {
	it("parseFilter('state:waiting parent:checkout pr:failing is:pinned flaky test') terms and text", () => {
		const raw = "state:waiting parent:checkout pr:failing is:pinned flaky test";
		const parsed = parseFilter(raw);

		expect(parsed.terms).toEqual([
			{ key: "state", value: "waiting" },
			{ key: "parent", value: "checkout" },
			{ key: "pr", value: "failing" },
			{ key: "is", value: "pinned" },
		]);
		expect(parsed.text).toBe("flaky test");
	});

	it("formatFilter round-trips", () => {
		const raw = "state:waiting parent:checkout pr:failing is:pinned flaky test";
		const parsed = parseFilter(raw);
		const formatted = formatFilter(parsed);

		expect(formatted).toBe(raw);
	});

	it("nodeMatches", () => {
		const filter = parseFilter("state:waiting parent:checkout pr:failing is:pinned flaky test");
		const matchingNode = makeNode();

		expect(nodeMatches(filter, matchingNode)).toBe(true);

		// Fails if title doesn't match text
		const nonTextNode = makeNode({ title: "other title" });
		expect(nodeMatches(filter, nonTextNode)).toBe(false);

		// Fails if state doesn't match
		const nonStateNode = makeNode({}, { info: { status: "working" } });
		expect(nodeMatches(filter, nonStateNode)).toBe(false);

		// Fails if not pinned
		const nonPinnedNode = makeNode({ pinnedAt: null });
		expect(nodeMatches(filter, nonPinnedNode)).toBe(false);

		// Fails if pr tone doesn't match
		const nonPrNode = makeNode({
			pr: {
				number: 42,
				tone: "ready",
			},
		});
		expect(nodeMatches(filter, nonPrNode)).toBe(false);

		// Fails if parent doesn't match
		const nonParentNode = makeNode({}, { parentTitle: "billing" });
		expect(nodeMatches(filter, nonParentNode)).toBe(false);
	});
});
