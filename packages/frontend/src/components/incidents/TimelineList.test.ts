// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TimelineEntryWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { entryTitle } from "./TimelineList";

const entry = (
	overrides: Partial<TimelineEntryWithRelations>,
): TimelineEntryWithRelations =>
	({
		id: "e1",
		incidentId: "inc-1",
		type: "status_changed",
		title: "Status changed",
		description: "Status changed from triggered to resolved",
		source: "system",
		metadata: null,
		occurredAt: "2026-10-07T10:00:00.000Z",
		createdAt: "2026-10-07T10:00:00.000Z",
		...overrides,
	}) as TimelineEntryWithRelations;

describe("entryTitle (#673 walk 4)", () => {
	it("keeps a custom title", () => {
		const e = entry({
			title: "Resolved, cause recorded",
			metadata: { previousStatus: "investigating", newStatus: "closed" },
		});
		expect(entryTitle(e)).toBe("Resolved, cause recorded");
	});

	it("names the state a bare status change reached", () => {
		expect(
			entryTitle(entry({ metadata: { previousStatus: "triggered", newStatus: "resolved" } })),
		).toBe("Alerts cleared");
		expect(
			entryTitle(entry({ metadata: { previousStatus: "identified", newStatus: "monitoring" } })),
		).toBe("Acknowledged");
	});

	it("leaves an entry without metadata unchanged", () => {
		expect(entryTitle(entry({}))).toBe("Status changed");
	});

	it("leaves a non-status entry titled Status changed unchanged", () => {
		const e = entry({
			type: "comment",
			metadata: { previousStatus: "triggered", newStatus: "resolved" },
		});
		expect(entryTitle(e)).toBe("Status changed");
	});
});
