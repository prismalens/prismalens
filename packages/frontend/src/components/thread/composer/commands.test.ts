// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReferenceHit, ReferenceSearchResult } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { type LocalCommand, menuResult } from "./commands";

const hit = (over: Partial<ReferenceHit>): ReferenceHit => ({
	ref: { kind: "command", id: "test", label: "/test" },
	source: "app",
	group: "Commands",
	why: "match",
	score: 1,
	...over,
});

describe("menuResult (#1024)", () => {
	it("lists the page's investigate action first, drops unoffered server app page actions, and keeps agent hits", () => {
		const local: LocalCommand[] = [
			{ id: "investigate", label: "Investigate", detail: "A run." },
		];
		const data: ReferenceSearchResult = {
			hits: [
				hit({
					ref: { kind: "command", id: "ask", label: "/ask" },
					source: "app",
					group: "Commands",
				}),
				hit({
					ref: { kind: "command", id: "agent:review", label: "/review" },
					source: "agent",
					group: "Codex",
				}),
			],
			truncated: false,
			unavailable: [],
		};

		const result = menuResult(data, { trigger: "/", query: "" }, local);
		expect(result?.hits.map((h) => h.ref.id)).toEqual([
			"investigate",
			"agent:review",
		]);
	});
});
