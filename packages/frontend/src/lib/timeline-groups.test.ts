// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TimelineEntryWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { groupTimeline } from "./timeline-groups";

function entry(
	id: string,
	at: string,
	metadata: Record<string, unknown> | null = null,
): TimelineEntryWithRelations {
	return {
		id,
		incidentId: "inc",
		type: "comment",
		title: id,
		description: null,
		source: "user",
		occurredAt: at,
		metadata,
		userId: null,
		createdAt: at,
		updatedAt: at,
	} as unknown as TimelineEntryWithRelations;
}

describe("groupTimeline", () => {
	const runs = [
		{ id: "b", status: "failed", error: "529" },
		{ id: "a", status: "completed" },
	];

	it("folds an investigation's entries into one item at its newest entry", () => {
		const items = groupTimeline(
			[
				entry("note", "2026-09-30T10:00:00Z"),
				entry("b-start", "2026-09-30T11:00:00Z", { investigationId: "b" }),
				entry("b-fail", "2026-09-30T11:01:00Z", { investigationId: "b" }),
				entry("a-start", "2026-09-30T09:00:00Z", {
					investigationId: "a",
					mapped: false,
				}),
			],
			runs,
		);
		expect(items.map((i) => (i.kind === "entry" ? i.entry.id : i.id))).toEqual(
			["b", "note", "a"],
		);
		const b = items[0];
		expect(b.kind === "investigation" && b.number).toBe(2);
		expect(b.kind === "investigation" && b.entries.map((e) => e.id)).toEqual([
			"b-fail",
			"b-start",
		]);
		const a = items[2];
		expect(a.kind === "investigation" && [a.number, a.noRepo]).toEqual([1, true]);
	});

	it("keeps an investigation the incident no longer lists, unnumbered", () => {
		const [item] = groupTimeline(
			[entry("x", "2026-09-30T10:00:00Z", { investigationId: "gone" })],
			runs,
		);
		expect(item.kind === "investigation" && [item.number, item.run]).toEqual([
			null,
			null,
		]);
	});
});
