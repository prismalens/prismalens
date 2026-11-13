// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	isUnseen,
	type SectionFacts,
	threadSection,
	unitsOf,
} from "./thread-sections.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const at = (iso: string) => new Date(`2026-11-${iso}Z`);

const facts = (over: Partial<SectionFacts> = {}): SectionFacts => ({
	status: "completed",
	incidentId: null,
	awaitingApprovalAt: null,
	lastTurnOutcome: "answered",
	lastVisitedAt: at("10T11:00:00"),
	settledAt: null,
	lastActivityAt: at("10T10:00:00"),
	incident: null,
	...over,
});

describe("threadSection (#1020)", () => {
	it("puts a waiting ask in Needs you, even on a settled thread", () => {
		const t = facts({
			status: "running",
			awaitingApprovalAt: at("10T11:30:00"),
			settledAt: at("10T11:59:00"),
		});
		expect(threadSection(t, NOW, 3)).toBe("needs");
	});

	it("puts an unseen answer or failure in Needs you, over a settle", () => {
		const answer = facts({
			lastVisitedAt: at("10T09:00:00"),
			settledAt: at("10T09:30:00"),
		});
		expect(threadSection(answer, NOW, 3)).toBe("needs");
		const failed = facts({ status: "failed", lastVisitedAt: null });
		expect(threadSection(failed, NOW, 3)).toBe("needs");
	});

	it("keeps a stopped or cancelled thread out of Needs you", () => {
		expect(isUnseen(facts({ status: "cancelled", lastVisitedAt: null }))).toBe(
			false,
		);
		expect(
			isUnseen(facts({ lastTurnOutcome: "stopped", lastVisitedAt: null })),
		).toBe(false);
	});

	it("lists a live thread as Active", () => {
		expect(threadSection(facts({ status: "running" }), NOW, 3)).toBe("active");
	});

	it("settles on Settle, and returns to Active on new activity", () => {
		const settled = facts({ settledAt: at("10T11:00:00") });
		expect(threadSection(settled, NOW, 3)).toBe("settled");
		const woke = facts({
			settledAt: at("10T11:00:00"),
			lastActivityAt: at("10T11:30:00"),
			lastVisitedAt: at("10T11:45:00"),
		});
		expect(threadSection(woke, NOW, 3)).toBe("active");
	});

	it("puts an unseen thread back where it was after Settle and Undo, recent or old", () => {
		for (const lastActivityAt of [at("10T11:30:00"), at("01T10:00:00")]) {
			const before = facts({ lastVisitedAt: null, lastActivityAt });
			expect(threadSection(before, NOW, 3)).toBe("needs");
			const settled = { ...before, settledAt: at("10T11:59:00") };
			expect(isUnseen(settled)).toBe(false);
			expect(threadSection(settled, NOW, 3)).toBe("settled");
			const undone = { ...settled, settledAt: null };
			expect(threadSection(undone, NOW, 3)).toBe("needs");
		}
	});

	it("settles an incident's thread once the incident is resolved", () => {
		const open = facts({
			incidentId: "i1",
			incident: { status: "investigating", closedAt: null },
		});
		expect(threadSection(open, NOW, 3)).toBe("active");
		const closed = facts({
			incidentId: "i1",
			incident: { status: "closed", closedAt: at("10T11:00:00") },
		});
		expect(threadSection(closed, NOW, 3)).toBe("settled");
		const later = facts({
			incidentId: "i1",
			incident: { status: "closed", closedAt: at("10T09:00:00") },
		});
		expect(threadSection(later, NOW, 3)).toBe("active");
	});

	it("settles a thread with no incident after the quiet days", () => {
		const quiet = facts({ lastActivityAt: at("07T12:00:00") });
		expect(threadSection(quiet, NOW, 3)).toBe("settled");
		expect(threadSection(quiet, NOW, 4)).toBe("active");
		const incidentThread = facts({
			incidentId: "i1",
			lastActivityAt: at("01T12:00:00"),
			incident: { status: "investigating", closedAt: null },
		});
		expect(threadSection(incidentThread, NOW, 3)).toBe("active");
	});

	it("tracks seen per thread, not per incident", () => {
		const opened = facts({ incidentId: "i1", lastVisitedAt: at("10T11:00:00") });
		const sibling = facts({ incidentId: "i1", lastVisitedAt: null });
		expect(isUnseen(opened)).toBe(false);
		expect(isUnseen(sibling)).toBe(true);
	});

	it("threadSection with status: 'approval' -> needs", () => {
		const t = facts({ status: "running" });
		expect(threadSection(t, NOW, 3, "approval")).toBe("needs");
	});

	it("threadSection with status: 'failed' unseen -> needs", () => {
		const t = facts({ status: "failed", lastVisitedAt: null });
		expect(threadSection(t, NOW, 3, "failed")).toBe("needs");
	});

	it("threadSection with status: 'failed' seen -> active", () => {
		const t = facts({ status: "failed", lastVisitedAt: at("10T11:00:00"), lastActivityAt: at("10T10:00:00") });
		expect(threadSection(t, NOW, 3, "failed")).toBe("active");
	});

	it("threadSection with status: 'done' unseen -> active", () => {
		const t = facts({ status: "completed", lastVisitedAt: null });
		expect(threadSection(t, NOW, 3, "done")).toBe("active");
	});
});

describe("unitsOf (#1020)", () => {
	const row = (
		id: string,
		incidentId: string | null,
		section: "needs" | "active" | "settled",
		hour: number,
	) => ({
		id,
		incidentId,
		section,
		lastActivityAt: new Date(Date.UTC(2026, 10, 10, hour)),
	});

	it("groups an incident's threads into one unit with its best section", () => {
		const units = unitsOf([
			row("a", "i1", "active", 1),
			row("b", null, "active", 5),
			row("c", "i1", "needs", 2),
			row("d", null, "settled", 9),
		]);
		expect(units.map((u) => u.threads.map((t) => t.id))).toEqual([
			["c", "a"],
			["b"],
			["d"],
		]);
		expect(units[0]?.section).toBe("needs");
	});

	it("lists a started thread as its own unit, and only an incident groups threads (#1101 cat 10, 2cc93e1ad)", () => {
		const started = (id: string, incidentId: string | null, rootId: string, hour: number) => ({
			...row(id, incidentId, "active", hour),
			rootId,
		});
		const units = unitsOf([
			started("child", null, "root", 3),
			row("other", "i1", "needs", 2),
			started("root", "i1", "root", 1),
			started("solo-child", null, "solo", 4),
			started("solo", null, "solo", 0),
		]);
		expect(units.map((u) => u.threads.map((t) => t.id).sort())).toEqual([
			["other", "root"],
			["solo-child"],
			["child"],
			["solo"],
		]);
		expect(units[0]).toMatchObject({ section: "needs", incidentId: "i1" });
	});
	it("orders units by section, then latest activity", () => {
		const units = unitsOf([
			row("old", null, "active", 1),
			row("new", null, "active", 8),
			row("ask", null, "needs", 0),
		]);
		expect(units.map((u) => u.threads[0]?.id)).toEqual(["ask", "new", "old"]);
	});
});
