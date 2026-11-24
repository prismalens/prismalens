// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	addedLines,
	changedLineCoverage,
	lineHits,
	notices,
	ranges,
	summary,
} from "./changed-line-coverage.mjs";

const DIFF = [
	"diff --git a/packages/api/src/a.ts b/packages/api/src/a.ts",
	"--- a/packages/api/src/a.ts",
	"+++ b/packages/api/src/a.ts",
	"@@ -10,0 +11,3 @@ fn",
	"+one",
	"+two",
	"+three",
	"@@ -20 +23,2 @@",
	"+changed",
	"+// a comment line: added, but lcov has no DA record for it",
	"diff --git a/packages/api/src/gone.ts b/packages/api/src/gone.ts",
	"--- a/packages/api/src/gone.ts",
	"+++ /dev/null",
	"@@ -1,2 +0,0 @@",
	"diff --git a/packages/frontend/src/b.tsx b/packages/frontend/src/b.tsx",
	"--- a/packages/frontend/src/b.tsx",
	"+++ b/packages/frontend/src/b.tsx",
	"@@ -1,0 +2,1 @@",
	"+x",
].join("\n");

// SF paths are relative to the package, with Windows separators when made on Windows.
const LCOV = [
	"TN:",
	"SF:src\\a.ts",
	"DA:11,4",
	"DA:12,0",
	"DA:13,0",
	"DA:23,1",
	"end_of_record",
	"SF:src/other.ts",
	"DA:1,0",
	"end_of_record",
].join("\r\n");

test("added lines come from each hunk's new side; a deleted file adds none", () => {
	assert.deepEqual(
		[...addedLines(DIFF)],
		[
			["packages/api/src/a.ts", [11, 12, 13, 23, 24]],
			["packages/frontend/src/b.tsx", [2]],
		],
	);
});

test("lcov paths resolve against their package, whatever the separator", () => {
	const hits = lineHits(LCOV, "packages/api");
	assert.deepEqual(
		[...hits.keys()],
		["packages/api/src/a.ts", "packages/api/src/other.ts"],
	);
	assert.deepEqual(
		[...hits.get("packages/api/src/a.ts")],
		[
			[11, 4],
			[12, 0],
			[13, 0],
			[23, 1],
		],
	);
});

test("only measured files count, and only their executable added lines", () => {
	const rows = changedLineCoverage(
		addedLines(DIFF),
		lineHits(LCOV, "packages/api"),
	);
	assert.deepEqual(rows, [
		{ file: "packages/api/src/a.ts", measured: 4, uncovered: [12, 13] },
	]);
});

test("runs of lines fold into ranges", () => {
	assert.deepEqual(ranges([3, 4, 5, 9, 11, 12]), [
		[3, 5],
		[9, 9],
		[11, 12],
	]);
});

test("the summary counts run lines and lists each gap as a range", () => {
	const rows = [
		{ file: "packages/api/src/a.ts", measured: 4, uncovered: [12, 13] },
		{ file: "packages/cli/src/b.ts", measured: 3, uncovered: [] },
	];
	assert.equal(
		summary(rows),
		[
			"### Changed-line coverage",
			"",
			"5 of 7 added executable lines run under a test. Information for the reviewer, not a gate.",
			"",
			"| File | Not run by any test |",
			"| --- | --- |",
			"| `packages/api/src/a.ts` | 12-13 |",
			"",
		].join("\n"),
	);
	assert.equal(
		summary([]),
		"### Changed-line coverage\n\nNo added line is in a package that measures coverage.\n",
	);
});

test("notices go on the largest gaps first, capped at GitHub's ten per step", () => {
	const rows = [
		{ file: "a.ts", measured: 9, uncovered: [1, 5, 6, 7] },
		{ file: "b.ts", measured: 2, uncovered: [20, 21] },
	];
	assert.deepEqual(notices(rows), [
		"::notice file=a.ts,line=5,endLine=7,title=Not run by any test::Lines 5-7 run under no test.",
		"::notice file=b.ts,line=20,endLine=21,title=Not run by any test::Lines 20-21 run under no test.",
		"::notice file=a.ts,line=1,endLine=1,title=Not run by any test::Line 1 run under no test.",
	]);
	const many = [
		{
			file: "c.ts",
			measured: 30,
			uncovered: Array.from({ length: 15 }, (_, i) => i * 2 + 1),
		},
	];
	assert.equal(notices(many).length, 10);
});
