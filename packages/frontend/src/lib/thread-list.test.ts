// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { rootOf, threadList } from "./thread-list.js";

const makeThread = (over: Partial<ThreadRow> = {}): ThreadRow =>
	({
		id: "t-1",
		title: "Thread 1",
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
		...over,
	}) as ThreadRow;

const makeUnit = (
	threads: ThreadRow[],
	section: "needs" | "active" | "settled" = "active",
): ThreadUnit => ({
	section,
	incident: null,
	threads,
});

describe("threadList and rootOf (#1101 category 1)", () => {
	it("puts needs-you threads (any depth) in needs oldest first", () => {
		const root = makeThread({
			id: "root-1",
			title: "Root Thread",
			lastActivityAt: "2026-11-12T11:00:00.000Z",
			state: { status: "working" },
		});
		const child1 = makeThread({
			id: "child-1",
			title: "Child 1",
			lastActivityAt: "2026-11-12T09:00:00.000Z", // older
			tree: { rootId: "root-1", parentId: "root-1", role: null, depth: 1 },
			state: { status: "approval" },
		});
		const child2 = makeThread({
			id: "child-2",
			title: "Child 2",
			lastActivityAt: "2026-11-12T10:00:00.000Z", // newer
			tree: { rootId: "root-1", parentId: "root-1", role: null, depth: 1 },
			state: { status: "question" },
		});

		const unit = makeUnit([root, child1, child2], "active");
		const model = threadList([unit]);

		expect(model.needs.map((n) => n.id)).toEqual(["child-1", "child-2"]);
	});

	it("a lone needs-you thread not in active", () => {
		const lone = makeThread({
			id: "lone-1",
			title: "Lone approval thread",
			state: { status: "approval" },
		});

		const unit = makeUnit([lone], "active");
		const model = threadList([unit]);

		expect(model.needs.map((n) => n.id)).toEqual(["lone-1"]);
		expect(model.active.map((n) => n.id)).toEqual([]);
	});

	it("pinned roots in pinned", () => {
		const pinnedRoot = makeThread({
			id: "pinned-1",
			title: "Pinned Thread",
			pinnedAt: "2026-11-12T10:00:00.000Z",
			state: { status: "working" },
		});

		const unit = makeUnit([pinnedRoot], "active");
		const model = threadList([unit]);

		expect(model.pinned.map((n) => n.id)).toEqual(["pinned-1"]);
		expect(model.active.map((n) => n.id)).toEqual([]);
	});

	it("settled units in settled", () => {
		const settledThread = makeThread({
			id: "settled-1",
			title: "Settled Thread",
			settledAt: "2026-11-12T10:00:00.000Z",
			state: { status: "done" },
		});

		const unit = makeUnit([settledThread], "settled");
		const model = threadList([unit]);

		expect(model.settled.map((n) => n.id)).toEqual(["settled-1"]);
		expect(model.active.map((n) => n.id)).toEqual([]);
	});

	it("a root's rolled.top over children", () => {
		const root = makeThread({
			id: "root-top",
			title: "Root Waiting",
			state: { status: "waiting" },
		});
		const child = makeThread({
			id: "child-app",
			title: "Child Approval",
			tree: { rootId: "root-top", parentId: "root-top", role: null, depth: 1 },
			state: { status: "approval" },
		});

		const unit = makeUnit([root, child], "active");
		const rootNode = rootOf(unit);

		expect(rootNode.rolled?.top).toBe("approval");
	});
});
