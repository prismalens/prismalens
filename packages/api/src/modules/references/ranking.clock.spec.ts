// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rank } from "./ranking.js";
import type { ReferenceCandidate } from "./reference-provider.js";

const file = (id: string): ReferenceCandidate => ({
	ref: { kind: "file", id, label: id.split("/").pop() ?? id },
});

// `rank` reads the clock when it is handed no `now`. A pick dated a day before the small tier's
// fixed date lifts a hit today and, with a real clock 40 days on, would not (frecency under 0.05);
// the fixed date keeps this test from ever depending on when it runs (#1154).
describe("rank reading the clock itself (#1154)", () => {
	it("a pick made the day before the fixed date still lifts its hit, whatever today is", () => {
		const used = new Map([
			["file:docs/pooling.md", { count: 1, lastUsedAt: new Date("2026-11-23T12:00:00Z") }],
		]);
		const hits = rank(
			[file("src/db/pool.ts"), file("docs/pooling.md")],
			"pool",
			{ used, agent: new Set<string>() },
		);
		expect(hits.find((h) => h.ref.id === "docs/pooling.md")?.why).toBe("used");
		expect(hits.find((h) => h.ref.id === "src/db/pool.ts")?.why).toBe("match");
	});
});
