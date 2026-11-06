// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FRECENCY_HALF_LIFE_MS, frecency, rank } from "./ranking.js";
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
