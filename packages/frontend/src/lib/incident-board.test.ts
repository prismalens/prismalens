// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { boardColumn, incidentHeadline, runWord } from "./incident-board";

function incident(
	status: string,
	run?: {
		status: string;
		rootCause?: string | null;
		createdAt?: string;
		completedAt?: string | null;
	},
	extra: Partial<IncidentWithRelations> = {},
): IncidentWithRelations {
	return {
		status,
		actualCause: null,
		investigations: run
			? [
					{
						id: "00000000-0000-0000-0000-000000000009",
						status: run.status,
						rootCause: run.rootCause ?? null,
						createdAt: run.createdAt ?? "2026-09-30T14:00:00Z",
						completedAt: run.completedAt ?? null,
					},
				]
			: [],
		...extra,
	} as IncidentWithRelations;
}

describe("boardColumn", () => {
	it("puts what wants a human first, with the list's predicate", () => {
		expect(boardColumn(incident("triggered"))).toBe("needs_you");
		expect(boardColumn(incident("investigating", { status: "failed" }))).toBe(
			"needs_you",
		);
		expect(boardColumn(incident("resolved"))).toBe("needs_you");
	});

	it("puts a live run in Working, even on a new incident", () => {
		expect(boardColumn(incident("investigating", { status: "running" }))).toBe(
			"working",
		);
		expect(boardColumn(incident("investigating", { status: "pending" }))).toBe(
			"working",
		);
	});

	it("puts an open incident whose run ended without a failure in Concluded", () => {
		expect(
			boardColumn(incident("investigating", { status: "completed" })),
		).toBe("concluded");
		expect(
			boardColumn(incident("investigating", { status: "cancelled" })),
		).toBe("concluded");
	});

	it("puts a closed incident in Resolved", () => {
		expect(boardColumn(incident("closed", { status: "completed" }))).toBe(
			"resolved",
		);
	});
});

describe("incidentHeadline", () => {
	it("says what the latest run did, from the list payload", () => {
		expect(incidentHeadline(incident("triggered"))).toEqual({
			text: "No run yet",
		});
		expect(
			incidentHeadline(incident("investigating", { status: "pending" })),
		).toEqual({ text: "Starting…" });
		expect(
			incidentHeadline(
				incident("investigating", {
					status: "completed",
					rootCause: "TTL cut in 3b7e0d",
				}),
			),
		).toEqual({ lead: "Likely:", text: "TTL cut in 3b7e0d" });
		expect(
			incidentHeadline(incident("investigating", { status: "failed" })),
		).toEqual({ text: "Run failed" });
		expect(
			incidentHeadline(
				incident("investigating", {
					status: "cancelled",
					completedAt: "2026-09-30T14:32:00Z",
				}),
			).text,
		).toMatch(/^Stopped by you at \d\d:\d\d$/);
	});

	it("prefers the recorded cause once the incident is closed", () => {
		expect(
			incidentHeadline(
				incident("closed", { status: "completed", rootCause: "x" }, {
					actualCause: "stale JWKS cache",
				}),
			),
		).toEqual({ lead: "Cause:", text: "stale JWKS cache" });
	});
});

describe("runWord", () => {
	it("gives the run's own word and minutes while live, nothing after", () => {
		const now = Date.parse("2026-09-30T14:04:30Z");
		expect(
			runWord(incident("investigating", { status: "running" }), now),
		).toEqual({ state: "working", text: "Working 4m" });
		expect(
			runWord(incident("investigating", { status: "cancelled" }), now),
		).toBeNull();
	});
});
