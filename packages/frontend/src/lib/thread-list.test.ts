// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { threadList } from "./thread-list.js";

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

describe("threadList (#1101 category 1, 561805422)", () => {
	it("lists every thread flat: each started thread that needs you is its own Needs-you row, counted once", () => {
		const starter = makeThread({
			id: "root-1",
			title: "Root Thread",
			lastActivityAt: "2026-11-12T11:00:00.000Z",
			state: { status: "working" },
		});
		const by = { id: "root-1", title: "Root Thread", link: "/threads/root-1", via: "agent" as const };
		const child1 = makeThread({
			id: "child-1",
			lastActivityAt: "2026-11-12T09:00:00.000Z",
			startedBy: by,
			state: { status: "approval" },
		});
		const child2 = makeThread({
			id: "child-2",
			lastActivityAt: "2026-11-12T10:00:00.000Z",
			startedBy: by,
			state: { status: "question" },
		});

		const model = threadList([makeUnit([starter]), makeUnit([child1]), makeUnit([child2])]);

		expect(model.needs.map((n) => n.id)).toEqual(["child-1", "child-2"]);
		expect(model.needsCount).toBe(2);
		expect(model.active.map((n) => n.id)).toEqual(["root-1"]);
	});

	it("sinks agent-started rows that need nothing below the rest, newest first within each", () => {
		const by = { id: "s", title: "Starter", link: "/threads/s", via: "agent" as const };
		const doneStarted = makeThread({ id: "done-started", lastActivityAt: "2026-11-12T12:00:00.000Z", startedBy: by, state: { status: "done" } });
		const workingStarted = makeThread({ id: "working-started", lastActivityAt: "2026-11-12T09:00:00.000Z", startedBy: by, state: { status: "working" } });
		const doneMine = makeThread({ id: "done-mine", lastActivityAt: "2026-11-12T08:00:00.000Z", state: { status: "done" } });
		const fork = makeThread({ id: "done-fork", lastActivityAt: "2026-11-12T11:00:00.000Z", startedBy: { ...by, via: "fork" }, state: { status: "done" } });

		const model = threadList([doneStarted, workingStarted, doneMine, fork].map((t) => makeUnit([t])));

		expect(model.active.map((n) => n.id)).toEqual(["done-fork", "working-started", "done-mine", "done-started"]);
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

	it("pinned threads in pinned", () => {
		const pinned = makeThread({
			id: "pinned-1",
			title: "Pinned Thread",
			pinnedAt: "2026-11-12T10:00:00.000Z",
			state: { status: "working" },
		});

		const model = threadList([makeUnit([pinned], "active")]);

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

		const model = threadList([makeUnit([settledThread], "settled")]);

		expect(model.settled.map((n) => n.id)).toEqual(["settled-1"]);
		expect(model.active.map((n) => n.id)).toEqual([]);
	});

	it("an incident's threads are rows of their own", () => {
		const a = makeThread({ id: "inc-a", lastActivityAt: "2026-11-12T10:00:00.000Z", state: { status: "working" } });
		const b = makeThread({ id: "inc-b", lastActivityAt: "2026-11-12T11:00:00.000Z", state: { status: "done" }, unseen: true });

		const model = threadList([makeUnit([a, b])]);

		expect(model.active.map((n) => n.id)).toEqual(["inc-b", "inc-a"]);
	});
});
