// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	answerLine,
	byRecordedCause,
	dayBars,
	median,
	shortDuration,
	tiles,
	windowFigures,
} from "./incident-analytics";

const MIN = 60;

function inc(
	status: string,
	extra: Partial<IncidentWithRelations> = {},
	run?: { status: string; rootCause?: string; rootCauseCategory?: string },
): IncidentWithRelations {
	return {
		status,
		severity: "high",
		triggeredAt: "2026-10-02T10:00:00Z",
		timeToAcknowledge: null,
		timeToResolve: null,
		timeToClose: null,
		actualCauseCategory: null,
		investigations: run
			? [
					{
						id: "00000000-0000-0000-0000-000000000001",
						status: run.status,
						rootCause: run.rootCause ?? null,
						rootCauseCategory: run.rootCauseCategory ?? null,
						createdAt: "2026-10-02T10:01:00Z",
						completedAt: null,
					},
				]
			: [],
		...extra,
	} as IncidentWithRelations;
}

const resolved = (minutes: number, category?: string, agent?: string) =>
	inc(
		"closed",
		{
			timeToAcknowledge: 4 * MIN,
			timeToClose: minutes * MIN,
			timeToResolve: (minutes - 10) * MIN,
			actualCauseCategory: (category ?? null) as IncidentWithRelations["actualCauseCategory"],
		},
		{ status: "completed", rootCause: "x", rootCauseCategory: agent },
	);

describe("Analytics, three kinds of month (study-v3 §3.6)", () => {
	it("a quiet month: how many, all resolved, and the median time to my Resolve", () => {
		const now = windowFigures([resolved(40), resolved(42), resolved(44)]);
		const before = windowFigures([resolved(40), resolved(40)]);
		const a = answerLine(now, before, 30, 0);
		expect(a.kind).toBe("quiet");
		expect(a.lead).toBe("A quiet month: 3 incidents, all resolved.");
		expect(a.sub).toContain("42 minutes to resolve");
		expect(a.sub).toContain("4 minutes to acknowledge");
		expect(a.sub).toContain("The agent investigated all 3; it named a cause every time.");
	});

	it("an active month: how many are open and how many need me now", () => {
		const open = Array.from({ length: 7 }, () => inc("investigating"));
		const now = windowFigures([...open, resolved(42), resolved(42), resolved(42)]);
		const a = answerLine(now, windowFigures(open.slice(0, 6)), 30, 3);
		expect(a.kind).toBe("active");
		expect(a.lead).toBe("Busy month: 10 incidents in the last 30 days, 7 of them still open.");
		expect(a.needYou).toBe(3);
	});

	it("a worse month says so, and each number says what it was before", () => {
		const now = windowFigures(Array.from({ length: 10 }, () => resolved(80)));
		const before = windowFigures(Array.from({ length: 4 }, () => resolved(42)));
		const a = answerLine(now, before, 30, 0);
		expect(a.kind).toBe("worse");
		expect(a.lead).toBe(
			"Worse than last month: 10 incidents, up from 4, and slower to resolve.",
		);
		const t = tiles(now, before, 30, 7, 3, a.kind);
		expect(t.map((x) => x.line)).toEqual([
			"up from 4",
			"paging to first human",
			"up from 42m",
			"4 of 4 the 30 days before",
		]);
		expect(t.map((x) => x.label)).toContain("Median to acknowledge");
		for (const x of t) expect(x.label.length).toBeLessThanOrEqual(22);
	});

	it("an empty window says so", () => {
		expect(answerLine(windowFigures([]), windowFigures([]), 30, 0).lead).toBe(
			"No incidents in the last 30 days",
		);
	});
});

describe("Analytics figures", () => {
	it("measures time to resolve to my Resolve, and time until alerts cleared on its own", () => {
		const f = windowFigures([resolved(30), resolved(50)]);
		expect(f.resolve).toBe(40 * MIN);
		expect(f.cleared).toBe(30 * MIN);
	});

	it("counts the agent's cause against mine only where I recorded a category", () => {
		const f = windowFigures([
			resolved(10, "code", "code"),
			resolved(10, "config", "code"),
			resolved(10, undefined, "code"),
		]);
		expect([f.matched, f.matchOf]).toEqual([1, 2]);
	});

	it("groups resolved incidents by recorded cause, unrecorded named so", () => {
		expect(
			byRecordedCause([resolved(1, "code"), resolved(1, "code"), resolved(1)]),
		).toEqual([
			{ key: "code", label: "Code", count: 2 },
			{ key: "none", label: "No cause recorded", count: 1 },
		]);
	});

	it("puts one bar per day, coloured by the day's worst severity", () => {
		const now = Date.parse("2026-10-02T18:00:00");
		const bars = dayBars(
			[
				inc("closed", { severity: "medium", triggeredAt: "2026-10-02T09:00:00" }),
				inc("closed", { severity: "critical", triggeredAt: "2026-10-02T11:00:00" }),
			],
			30,
			now,
		);
		expect(bars).toHaveLength(30);
		expect(bars.at(-1)).toMatchObject({ count: 2, severity: "critical" });
		expect(bars[0]?.count).toBe(0);
	});

	it("takes medians and short durations", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([])).toBeNull();
		expect(shortDuration(80 * MIN)).toBe("1h 20m");
		expect(shortDuration(6 * MIN)).toBe("6m");
	});
});
