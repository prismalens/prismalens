// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { awayItems } from "./away";

const SINCE = Date.parse("2026-11-04T08:00:00Z");
const at = (h: number) => new Date(SINCE + h * 3_600_000).toISOString();
type Run = NonNullable<IncidentWithRelations["investigations"]>[number];

const incident = (p: Partial<IncidentWithRelations>) =>
	({
		id: crypto.randomUUID(),
		number: 1,
		title: "t",
		status: "investigating",
		severity: "high",
		triggeredAt: at(-5),
		createdAt: at(-5),
		alertCount: 0,
		alerts: [],
		investigations: [],
		...p,
	}) as IncidentWithRelations;
const alerted = (source: string, created: number) =>
	incident({
		alertCount: 1,
		alerts: [{ id: "a", status: "triggered", source, triggeredAt: at(created) }],
		createdAt: at(created),
		triggeredAt: at(created),
	} as Partial<IncidentWithRelations>);
const done = (h: number) =>
	({
		id: crypto.randomUUID(),
		status: "completed",
		kind: "investigation",
		rootCause: null,
		createdAt: at(h - 0.1),
		completedAt: at(h),
	}) as Run;

describe("awayItems: while you were away (#1020)", () => {
	it("is empty on a first visit and when nothing happened", () => {
		expect(awayItems([alerted("prometheus", 1)], null)).toEqual([]);
		expect(awayItems([alerted("prometheus", -2)], SINCE)).toEqual([]);
	});
	it("names a single alert that arrived and links it to its thread", () => {
		const one = alerted("prometheus", 1);
		const items = awayItems([one], SINCE);
		expect(items[0]).toEqual({
			key: "arrived",
			text: "t arrived",
			incidentId: one.id,
		});
	});
	it("says events when a non-alert trigger arrived too", () => {
		const items = awayItems(
			[alerted("prometheus", 1), alerted("ci", 2)],
			SINCE,
		);
		expect(items[0]).toMatchObject({ text: "2 threads arrived, newest t", incidentId: null });
	});
	it("names a single finished run's thread, and ignores threads you started", () => {
		const mine = incident({ createdAt: at(1), investigations: [done(1.5)] });
		const items = awayItems([mine], SINCE);
		expect(items.map((i) => i.key)).toEqual(["finished"]);
		expect(items[0]?.text).toBe("t finished");
	});
	it("counts what finished first and names the newest after", () => {
		const a = incident({ createdAt: at(1), investigations: [done(1.5)] });
		const b = incident({ createdAt: at(1), investigations: [done(1.6)] });
		expect(awayItems([a, b], SINCE)[0]?.text).toBe("2 runs finished, newest t");
	});
});
