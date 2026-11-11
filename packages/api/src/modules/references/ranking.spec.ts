// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FRECENCY_HALF_LIFE_MS, frecency, matchTier, rank } from "./ranking.js";
import type { ReferenceCandidate } from "./reference-provider.js";

const NOW = new Date("2026-11-07T10:00:00Z");
const file = (id: string): ReferenceCandidate => ({
	ref: { kind: "file", id, label: id.split("/").pop() ?? id },
});
const none = { used: new Map(), agent: new Set<string>() };

describe("reference ranking (#1024)", () => {
	const files = [
		file("src/db/pool.ts"),
		file("src/db/pool.test.ts"),
		file("docs/pooling.md"),
		file("src/http/server.ts"),
	];

	it("match: the fuzzy score orders hits, and a query that matches nothing drops them", () => {
		const hits = rank(files, "pool.ts", none, NOW);
		expect(hits[0]?.ref.id).toBe("src/db/pool.ts");
		expect(hits.every((h) => h.why === "match")).toBe(true);
		expect(hits.map((h) => h.ref.id)).not.toContain("src/http/server.ts");
	});

	it("used: a recent pick outranks a better match, and why says so", () => {
		const used = new Map([
			["file:docs/pooling.md", { count: 4, lastUsedAt: NOW }],
		]);
		const hits = rank(files, "pool", { ...none, used }, NOW);
		expect(hits[0]).toMatchObject({ ref: { id: "docs/pooling.md" }, why: "used" });
	});

	it("frecency halves every 7 days", () => {
		const old = new Date(NOW.getTime() - FRECENCY_HALF_LIFE_MS);
		expect(frecency({ count: 4, lastUsedAt: old }, NOW)).toBeCloseTo(2);
		expect(frecency({ count: 4, lastUsedAt: NOW }, NOW)).toBe(4);
	});

	it("agent: a file the agent touched in this thread rises", () => {
		const agent = new Set(["file:src/db/pool.test.ts"]);
		const hits = rank(files, "pool", { ...none, agent }, NOW);
		expect(hits[0]).toMatchObject({ ref: { id: "src/db/pool.test.ts" }, why: "agent" });
	});

	it("open: what the panel has open comes first, even over a pick and a touch", () => {
		const hits = rank(
			files,
			"",
			{
				used: new Map([["file:docs/pooling.md", { count: 9, lastUsedAt: NOW }]]),
				agent: new Set(["file:src/db/pool.test.ts"]),
				open: "file:src/http/server.ts",
			},
			NOW,
		);
		expect(hits[0]).toMatchObject({ ref: { id: "src/http/server.ts" }, why: "open" });
		expect(hits.map((h) => h.why)).toEqual(["open", "used", "agent", "match"]);
	});
});

describe("match tiers (#1024)", () => {
	const DESK = "PR desk: Wave 1 review and merge";
	const thread = (id: string, label: string, at: number, active = false): ReferenceCandidate => ({
		ref: { kind: "thread", id, label },
		group: "Threads",
		at,
		active,
	});
	// Newest first; the desk thread is neither the newest nor running.
	const threads = [
		thread("t1", "Preview deploys on staging", 9, true),
		thread("t2", "Prod DB pool exhausted", 8, true),
		thread("t3", "Fix prisma client generate", 7),
		thread("t4", "Review the PRD for alerts", 6),
		thread("t5", DESK, 5),
		thread("t6", "Wave 2 planning", 4),
		thread("t7", "Paging dashboard widgets", 3),
	];

	it("names each tier: prefix, word start, acronym, loose letters", () => {
		expect(matchTier("@PR", DESK)?.tier).toBe(1);
		expect(matchTier("desk", DESK)?.tier).toBe(2);
		expect(matchTier("PRdesk", DESK)?.tier).toBe(3);
		expect(matchTier("pdw", DESK)?.tier).toBe(3);
		// A leading trigger is dropped for the loose tier too: `@dsk` meets "PR desk" as `dsk` does.
		expect(matchTier("@dsk", DESK)).toEqual(matchTier("dsk", DESK));
		expect(matchTier("dsk", DESK)?.tier).toBe(4);
		expect(matchTier("pdwm", DESK)?.tier).toBe(3);
		expect(matchTier("rvw", DESK)?.tier).toBe(4);
		expect(matchTier("zzz", DESK)).toBeNull();
	});

	it("@PRdesk and @pdw put the desk thread first among realistic threads", () => {
		expect(rank(threads, "@PRdesk", none, NOW)[0]?.ref.id).toBe("t5");
		expect(rank(threads, "pdw", none, NOW).map((h) => h.ref.id)).toEqual(["t5", "t7"]);
	});

	it("@PR: label prefixes first, running threads then newest within the tier, then word starts", () => {
		expect(rank(threads, "@PR", none, NOW).map((h) => h.ref.id)).toEqual(["t1", "t2", "t5", "t3", "t4", "t7"]);
	});

	it("a past pick lifts the desk thread to the top of its tier", () => {
		const used = new Map([["thread:t5", { count: 3, lastUsedAt: NOW }]]);
		expect(rank(threads, "@PR", { ...none, used }, NOW)[0]).toMatchObject({ ref: { id: "t5" }, why: "used" });
	});
});
