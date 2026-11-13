// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	bump,
	compare,
	countText,
	formatTsv,
	HEADER,
	lintFacts,
	parseTsv,
} from "./ratchet.ts";

describe("the ratchet TSV", () => {
	it("round-trips sorted facts and drops zero counts", () => {
		const facts = new Map<string, number>();
		bump(facts, "src/b.ts", "L3");
		bump(facts, "src/a.ts", "as-never", 2);
		bump(facts, "src/c.ts", "L5", 0);
		const text = formatTsv(facts);
		expect(text).toBe(`${HEADER}\nsrc/a.ts\tas-never\t2\nsrc/b.ts\tL3\t1\n`);
		expect(Array.from(parseTsv(text).facts)).toEqual([
			["src/a.ts\tas-never", 2],
			["src/b.ts\tL3", 1],
		]);
	});

	it("names a malformed line, a duplicate and unsorted lines", () => {
		const { problems } = parseTsv("b.ts\tL1\t1\na.ts\tL1\t1\na.ts\tL1\t2\nbad line\n");
		expect(problems).toEqual([
			"ratchet lists a.ts L1 twice",
			'ratchet line 4 is not "file<TAB>rule<TAB>count>0": bad line',
			"ratchet lines are not sorted",
		]);
	});
});

describe("counting", () => {
	it("counts suppressions and never-casts per file", () => {
		const facts = new Map<string, number>();
		countText(facts, "a.ts", "// biome-ignore lint/x: y\nconst a = b as never;\nconst c = d as never;\nconst e = f as nevermore;");
		expect(Array.from(facts)).toEqual([
			["a.ts\tbiome-ignore", 1],
			["a.ts\tas-never", 2],
		]);
	});

	it("counts only plugin diagnostics that carry a rule tag", () => {
		const facts = new Map<string, number>();
		lintFacts(
			{
				diagnostics: [
					{ category: "plugin", message: "[L3] inline", location: { path: "src\\a.tsx" } },
					{ category: "plugin", message: "[L3] inline", location: { path: "src\\a.tsx" } },
					{ category: "plugin", message: "A raw colour", location: { path: "src\\a.tsx" } },
					{ category: "lint/style/x", message: "[L3] not a plugin", location: { path: "src\\b.tsx" } },
				],
			},
			(p) => p.split("\\").join("/"),
			facts,
		);
		expect(Array.from(facts)).toEqual([["src/a.tsx\tL3", 2]]);
	});
});

describe("compare", () => {
	it("fails a rise, including a new file, and a stale line, each naming its fix", () => {
		const listed = new Map([
			["a.ts\tL3", 2],
			["b.ts\tas-never", 3],
		]);
		const actual = new Map([
			["a.ts\tL3", 3],
			["b.ts\tas-never", 1],
			["c.ts\tbiome-ignore", 1],
		]);
		expect(compare(listed, actual)).toEqual([
			"a.ts: L3 rose from 2 to 3. Fix the new hit as its lint message says; a raise needs the operator's label on the PR.",
			"c.ts: biome-ignore rose from 0 to 1. Fix the cause instead of suppressing or casting it; a raise needs the operator's label on the PR.",
			"b.ts: as-never fell from 3 to 1. Lower the ratchet: run `pnpm registry ratchet --write` and commit it.",
		]);
	});

	it("holds when nothing moved", () => {
		const same = new Map([["a.ts\tL3", 2]]);
		expect(compare(same, new Map(same))).toEqual([]);
	});
});
