// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReferenceHit, ReferenceSearchResult } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	type LocalCommand,
	menuResult,
	shortDetail,
} from "./commands";

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

describe("menu secondaries (sheet §0.3, #1101)", () => {
	it("keeps a detail of five words or fewer, and drops a longer one or one that repeats the name", () => {
		expect(shortDetail({ id: "ask", label: "Ask", detail: "Ends in an answer" })).toBe(
			"Ends in an answer",
		);
		expect(
			shortDetail({
				id: "note",
				label: "Note",
				detail: "Goes on the timeline. The agent never reads it.",
			}),
		).toBeUndefined();
		expect(shortDetail({ id: "note", label: "Note", detail: "Note" })).toBeUndefined();
		expect(shortDetail({ id: "note", label: "Note" })).toBeUndefined();
	});

	it("shows a page action with no detail by its name alone, never its label again", () => {
		const result = menuResult(undefined, { trigger: "/", query: "" }, [
			{ id: "investigate", label: "Investigate" },
		]);
		expect(result?.hits).toHaveLength(1);
		expect(result?.hits[0]?.ref.label).toBe("/investigate");
		expect(result?.hits[0]?.detail).toBeUndefined();
	});
});
