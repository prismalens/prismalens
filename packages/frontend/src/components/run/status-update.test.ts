// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { statusUpdateDraft } from "./status-update";

const now = Date.parse("2026-10-11T12:00:00Z");
const base = {
	number: 7,
	title: "WalkGrouped",
	severity: "high",
	status: "investigating",
	actualCause: null,
	service: { name: "booklogr-api", displayName: null },
	alerts: [{ status: "triggered", triggeredAt: "2026-10-11T10:00:00Z" }],
	investigations: [],
} as unknown as IncidentWithRelations;
const run = (over: Record<string, unknown>) => ({
	kind: "investigation",
	status: "completed",
	rootCause: null,
	createdAt: "2026-10-11T10:05:00Z",
	...over,
});

describe("statusUpdateDraft", () => {
	it("names the incident, how long it has fired and the newest likely cause", () => {
		const incident = {
			...base,
			investigations: [
				run({ rootCause: "old guess", createdAt: "2026-10-11T10:01:00Z" }),
				run({ rootCause: "Python sort since v1.42" }),
				run({ kind: "chat", rootCause: "an answer", createdAt: "2026-10-11T11:00:00Z" }),
			],
		} as unknown as IncidentWithRelations;
		expect(statusUpdateDraft(incident, now)).toBe(
			"INC-7 WalkGrouped, booklogr-api. Severity High.\nFiring for 2h 00m.\nLikely cause: Python sort since v1.42",
		);
	});

	it("says a run is under way when nothing has concluded", () => {
		const incident = {
			...base,
			investigations: [run({ status: "running" })],
		} as unknown as IncidentWithRelations;
		expect(statusUpdateDraft(incident, now)).toContain(
			"An investigation is running; no cause yet.",
		);
	});

	it("uses the recorded cause once resolved", () => {
		const incident = {
			...base,
			status: "closed",
			actualCause: "pool capped",
		} as unknown as IncidentWithRelations;
		expect(statusUpdateDraft(incident, now).split("\n").slice(1)).toEqual([
			"Resolved.",
			"Cause: pool capped",
		]);
	});
});
