// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { heldModel, layoutOf } from "./thread-hold";
import { threadList } from "./thread-list";

const row = (id: string, status: string, at: string, over = {}): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [
		{
			id,
			title: `T ${id}`,
			status: "completed",
			kind: "chat",
			origin: "local",
			schemaVersion: 1,
			createdAt: "2026-11-12T10:00:00.000Z",
			updatedAt: "2026-11-12T10:00:00.000Z",
			lastActivityAt: at,
			lastVisitedAt: at,
			settledAt: null,
			unseen: false,
			latestText: null,
			projectName: null,
			titleSetBy: null,
			serviceName: null,
			section: "active",
			state: { status },
			...over,
		} as unknown as ThreadRow,
	],
});

const ids = (m: { needs: { id: string }[]; active: { id: string }[] }) => ({
	needs: m.needs.map((n) => n.id),
	active: m.active.map((n) => n.id),
});

const before = threadList([
	row("ask", "question", "2026-11-12T09:00:00.000Z"),
	row("a", "working", "2026-11-12T11:00:00.000Z"),
	row("b", "done", "2026-11-12T10:00:00.000Z"),
]);

describe("heldModel keeps every row where the reader saw it (#1247 D25)", () => {
	it("keeps a row that moved to Needs you in Threads, marked moving there, with Needs you's live count", () => {
		const live = threadList(
			[
				row("ask", "question", "2026-11-12T09:00:00.000Z"),
				row("a", "approval", "2026-11-12T11:30:00.000Z"),
				row("b", "done", "2026-11-12T10:00:00.000Z"),
			],
			7,
		);
		const held = heldModel(live, layoutOf(before));
		expect(ids(held.model)).toEqual({ needs: ["ask"], active: ["a", "b"] });
		expect([...held.moving]).toEqual([["a", "needs"]]);
		expect(held.model.active[0]?.info.status).toBe("working");
		expect(held.model.needsCount).toBe(7);
		expect(held.pending).toBe(1);
	});

	it("keeps rows in their held order when newer activity would reorder them, counting both as pending", () => {
		const live = threadList([
			row("ask", "question", "2026-11-12T09:00:00.000Z"),
			row("a", "working", "2026-11-12T11:00:00.000Z"),
			row("b", "working", "2026-11-12T11:45:00.000Z"),
		]);
		const held = heldModel(live, layoutOf(before));
		expect(ids(live)).toEqual({ needs: ["ask"], active: ["b", "a"] });
		expect(ids(held.model)).toEqual({ needs: ["ask"], active: ["a", "b"] });
		expect(held.model.active[1]?.info.status).toBe("working");
		expect(held.moving.size).toBe(0);
		expect(held.pending).toBe(2);
	});

	it("leaves a row that arrived out until the hold ends, and keeps one that left, marked gone", () => {
		const live = threadList([
			row("ask", "question", "2026-11-12T09:00:00.000Z"),
			row("a", "working", "2026-11-12T11:00:00.000Z"),
			row("new", "working", "2026-11-12T11:50:00.000Z"),
		]);
		const held = heldModel(live, layoutOf(before));
		expect(ids(held.model)).toEqual({ needs: ["ask"], active: ["a", "b"] });
		expect([...held.moving]).toEqual([["b", "gone"]]);
		expect(held.pending).toBe(2);
	});

	it("draws the live list unchanged when nothing moved", () => {
		const held = heldModel(before, layoutOf(before));
		expect(ids(held.model)).toEqual(ids(before));
		expect(held.model.active[0]).toBe(before.active[0]);
		expect(held.moving.size).toBe(0);
		expect(held.pending).toBe(0);
	});
});
