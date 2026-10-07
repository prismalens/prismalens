// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	boardColumn,
	cardWord,
	clockElapsed,
	headlineAddsInfo,
	incidentHeadline,
	incidentLineage,
	orderNeedsYou,
	rowGlyph,
	runWord,
} from "./incident-board";

function incident(
	status: string,
	run?: {
		status: string;
		rootCause?: string | null;
		createdAt?: string;
		completedAt?: string | null;
		lastEventAt?: string | null;
		latestText?: string | null;
		error?: string | null;
		evidenceCount?: number | null;
		stopRequestedAt?: string | null;
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
						lastEventAt: run.lastEventAt ?? null,
						latestText: run.latestText ?? null,
						error: run.error ?? null,
						evidenceCount: run.evidenceCount ?? null,
						stopRequestedAt: run.stopRequestedAt ?? null,
					},
				]
			: [],
		...extra,
	} as IncidentWithRelations;
}

describe("boardColumn (R1a d6)", () => {
	it("puts what wants a human in Needs you, even while its run is live", () => {
		expect(boardColumn(incident("triggered"))).toBe("needs_you");
		expect(boardColumn(incident("triggered", { status: "running" }))).toBe(
			"needs_you",
		);
		expect(boardColumn(incident("investigating", { status: "failed" }))).toBe(
			"needs_you",
		);
		expect(boardColumn(incident("resolved"))).toBe("needs_you");
	});

	it("puts an acknowledged incident with a live run in Working", () => {
		expect(boardColumn(incident("investigating", { status: "running" }))).toBe(
			"working",
		);
		expect(boardColumn(incident("investigating", { status: "pending" }))).toBe(
			"working",
		);
		expect(boardColumn(incident("closed", { status: "running" }))).toBe(
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
		expect(boardColumn(incident("identified"))).toBe("concluded");
	});

	it("puts the operator's Resolve in Resolved", () => {
		expect(boardColumn(incident("closed", { status: "completed" }))).toBe(
			"resolved",
		);
	});

	it("keeps a reopened incident in Needs you until a run starts after the reopen", () => {
		const reopened = {
			reopenReason: "operator" as const,
			reopenedAt: "2026-09-30T15:00:00Z",
		};
		expect(
			boardColumn(
				incident(
					"investigating",
					{ status: "completed", createdAt: "2026-09-30T14:00:00Z" },
					reopened,
				),
			),
		).toBe("needs_you");
		expect(
			cardWord(
				incident(
					"investigating",
					{ status: "completed", createdAt: "2026-09-30T14:00:00Z" },
					reopened,
				),
			),
		).toEqual({ text: "Reopened by you, cause not confirmed", tone: "warn" });
		expect(
			boardColumn(
				incident(
					"investigating",
					{ status: "running", createdAt: "2026-09-30T15:01:00Z" },
					reopened,
				),
			),
		).toBe("working");
	});
});

describe("orderNeedsYou (study-v3 §3.1)", () => {
	it("lists firing first, then a failed run, then a reopen, then Alerts cleared", () => {
		const cleared = incident("resolved", undefined, { number: 1 });
		const reopened = incident("investigating", undefined, {
			number: 2,
			reopenReason: "operator",
			reopenedAt: "2026-09-30T15:00:00Z",
		});
		const failed = incident("investigating", { status: "failed" }, { number: 3 });
		const firing = incident("triggered", undefined, { number: 4 });
		expect(
			orderNeedsYou([cleared, reopened, failed, firing]).map((i) => i.number),
		).toEqual([4, 3, 2, 1]);
	});
});

describe("cardWord (study-v3 §4)", () => {
	it("says what is left to do, never Closed or Awaiting close", () => {
		expect(cardWord(incident("triggered"))).toEqual({
			text: "Needs acknowledging",
			tone: "danger",
		});
		expect(cardWord(incident("resolved"))).toEqual({
			text: "Alerts cleared",
			tone: "plain",
			since: undefined,
		});
		expect(
			cardWord(incident("investigating", { status: "failed" }))?.text,
		).toBe("Run failed");
		expect(cardWord(incident("investigating"))?.text).toBe("Acknowledged");
		expect(cardWord(incident("closed"))?.text).toBe("Resolved");
	});

	it("names how a concluded run ended and how long it took (#673 w14)", () => {
		expect(
			cardWord(
				incident("investigating", {
					status: "completed",
					createdAt: "2026-09-30T15:00:00Z",
					completedAt: "2026-09-30T15:01:02Z",
				}),
			),
		).toEqual({ text: "Done", tone: "plain", since: "1m 02s" });
		expect(
			cardWord(
				incident("investigating", {
					status: "cancelled",
					createdAt: "2026-09-30T15:00:00Z",
					completedAt: "2026-09-30T15:00:38Z",
				}),
			),
		).toEqual({ text: "Stopped by you", tone: "plain", since: "38s" });
	});

	it("reads Back again for a flap refire, not Fired again", () => {
		expect(
			cardWord(
				incident("triggered", undefined, {
					reopenReason: "flap",
					reopenedAt: "2026-09-30T15:00:00Z",
				}),
			),
		).toEqual({ text: "Back again", tone: "danger" });
	});
});

describe("incidentHeadline", () => {
	it("says what the latest run did, from the list payload", () => {
		expect(incidentHeadline(incident("triggered"))).toEqual({
			text: "No investigation yet",
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
			incidentHeadline(
				incident("investigating", {
					status: "failed",
					error: "harness exited early (code=1): API Error: 401 invalid x-api-key",
				}),
			),
		).toEqual({ text: "The agent is not signed in to its model provider." });
		expect(
			incidentHeadline(
				incident("investigating", {
					status: "cancelled",
					completedAt: "2026-09-30T14:32:00Z",
				}),
			).text,
		).toMatch(/^Stopped by you at \d\d:\d\d$/);
	});

	it("keeps the investigation's cause after a chat ends, and shows a live chat", () => {
		const withChat = (chatStatus: string) => {
			const base = incident("investigating", {
				status: "completed",
				rootCause: "TTL cut in 3b7e0d",
			});
			const [investigation] = base.investigations ?? [];
			return {
				...base,
				investigations: [
					investigation,
					{
						...investigation,
						id: "00000000-0000-0000-0000-000000000010",
						kind: "chat",
						status: chatStatus,
						rootCause: null,
						createdAt: "2026-09-30T15:00:00Z",
					},
				],
			} as IncidentWithRelations;
		};
		const cause = { lead: "Likely:", text: "TTL cut in 3b7e0d" };
		expect(incidentHeadline(withChat("completed"))).toEqual(cause);
		expect(incidentHeadline(withChat("failed"))).toEqual(cause);
		expect(incidentHeadline(withChat("pending"))).toEqual({ text: "Starting…" });
	});

	it("reads the live sentence's first clause", () => {
		expect(
			incidentHeadline(
				incident("investigating", {
					status: "running",
					lastEventAt: "2026-09-30T14:04:00Z",
					latestText: "Comparing the TTL change in 9f3c1a. Then the deploy.",
				}),
			),
		).toEqual({ text: "Comparing the TTL change in 9f3c1a" });
	});

	it("reads the recorded cause on a Resolved incident, or says none was recorded", () => {
		expect(
			incidentHeadline(
				incident("closed", { status: "completed", rootCause: "x" }, {
					actualCause: "stale JWKS cache",
				}),
			),
		).toEqual({ lead: "Cause:", text: "stale JWKS cache" });
		expect(incidentHeadline(incident("closed"))).toEqual({
			text: "No cause recorded",
		});
	});
});

describe("incidentLineage (R1a d5, d6)", () => {
	it("names the incident a new one fired again after, with its cause", () => {
		expect(
			incidentLineage(
				incident("triggered", undefined, {
					priorIncident: {
						number: 1,
						status: "closed",
						actualCause: "pool capped at 10",
					},
				}),
			),
		).toEqual({
			lead: "Fired again:",
			text: "after INC-1 was resolved, cause: pool capped at 10",
		});
	});

	it("points a Resolved incident at the one that fired again after it", () => {
		const line = incidentLineage(
			incident("closed", undefined, {
				refiredAs: {
					id: "00000000-0000-0000-0000-000000000011",
					number: 11,
					createdAt: "2026-09-30T17:40:00Z",
				},
			}),
		);
		expect(line?.lead).toBe("Fired again as");
		expect(line?.text).toMatch(/^INC-11, \d\d:\d\d$/);
	});
});

describe("runWord (study-v3 §3.1)", () => {
	const now = Date.parse("2026-09-30T14:04:30Z");

	it("gives the step and a ticking elapsed time while live, nothing after", () => {
		expect(
			runWord(incident("investigating", { status: "running" }), now)?.text,
		).toBe("Starting 4:30");
		expect(
			runWord(
				incident("investigating", {
					status: "running",
					lastEventAt: "2026-09-30T14:04:00Z",
					latestText: "Reading worker/consumer.py",
				}),
				now,
			)?.text,
		).toBe("Reading worker/consumer.py 4:30");
		expect(
			runWord(incident("investigating", { status: "cancelled" }), now),
		).toBeNull();
	});

	it("reads Working 14m, quiet for 5 min once the run goes quiet", () => {
		const later = Date.parse("2026-09-30T14:14:30Z");
		const word = runWord(
			incident("investigating", {
				status: "running",
				lastEventAt: "2026-09-30T14:09:00Z",
				latestText: "Reading",
			}),
			later,
		);
		expect(word?.text).toBe("Working 14m, quiet for 5 min");
		expect(word?.quietFor).toBe(5);
	});

	it("formats elapsed as m:ss and h:mm:ss", () => {
		expect(clockElapsed(21)).toBe("0:21");
		expect(clockElapsed(108)).toBe("1:48");
		expect(clockElapsed(3729)).toBe("1:02:09");
	});
});

describe("headlineAddsInfo", () => {
	it("drops a headline that only repeats the state word", () => {
		expect(headlineAddsInfo({ text: "Working…" })).toBe(false);
		expect(headlineAddsInfo({ text: "Run failed" })).toBe(false);
		expect(headlineAddsInfo({ text: "No investigation yet" })).toBe(true);
		expect(headlineAddsInfo({ lead: "Likely:", text: "TTL cut" })).toBe(true);
	});
});

describe("rowGlyph (R1a d6)", () => {
	it("follows the board's column so the sidebar never disagrees", () => {
		expect(rowGlyph(incident("triggered", { status: "running" }))).toBe(
			"attention",
		);
		expect(rowGlyph(incident("investigating", { status: "running" }))).toBe(
			"live",
		);
		expect(rowGlyph(incident("investigating", { status: "failed" }))).toBe(
			"attention",
		);
		expect(rowGlyph(incident("investigating", { status: "completed" }))).toBe(
			"open",
		);
		expect(rowGlyph(incident("resolved"))).toBe("attention");
		expect(rowGlyph(incident("closed"))).toBe("ended");
	});
});
