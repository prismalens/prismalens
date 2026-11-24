// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check, findTags } from "./quarantine-check.mjs";

const NOW = Date.parse("2026-11-24T00:00:00Z");
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();

function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), "quarantine-"));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, name)), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}
const tagLines = (n) =>
	Array.from(
		{ length: n },
		(_, i) => `\t@quarantine #${100 + i}\n\tScenario: s${i}\n`,
	).join("");
const openIssue = () => ({ state: "OPEN", createdAt: day(1) });

test("findTags returns the file, line and text of each tag in features and specs", () => {
	const root = fixture({
		"features/a.feature": "Feature: a\n  @quarantine #5\n  Scenario: x\n",
		"specs/b.spec.ts": 'test("y", { tag: "@quarantine" }, () => {}); // #6\n',
		"specs/c.spec.ts": 'test("z", () => {});\n',
	});
	assert.deepEqual(
		findTags(root).sort((a, b) => a.file.localeCompare(b.file)),
		[
			{ file: "features/a.feature", line: 2, text: "  @quarantine #5" },
			{
				file: "specs/b.spec.ts",
				line: 1,
				text: 'test("y", { tag: "@quarantine" }, () => {}); // #6',
			},
		],
	);
});

test("a feature comment that mentions @quarantine is not a tag, and the tag after it still is", () => {
	const root = fixture({
		"a.feature":
			"Feature: a\n  # Remove @quarantine after repair\n  @quarantine #123\n  Scenario: x\n",
	});
	assert.deepEqual(findTags(root), [
		{ file: "a.feature", line: 3, text: "  @quarantine #123" },
	]);
});

test("six tags fail on the cap and name the count", () => {
	const tags = findTags(fixture({ "a.feature": tagLines(6) }));
	assert.deepEqual(check(tags, { issue: openIssue, now: NOW }), [
		"6 @quarantine tags; at most 5 are allowed",
	]);
});

test("five tags with open recent issues pass", () => {
	const tags = findTags(fixture({ "a.feature": tagLines(5) }));
	assert.deepEqual(check(tags, { issue: openIssue, now: NOW }), []);
});

test("a tag with no issue number on its line names its file and line", () => {
	const tags = findTags(
		fixture({ "a.feature": "# #7\n@quarantine\nScenario: s\n" }),
	);
	assert.deepEqual(check(tags, { issue: openIssue, now: NOW }), [
		"a.feature:2: names no issue; put its #number on the same line as @quarantine",
	]);
});

test("a closed issue and a 14-day-old issue are each named, a 13-day-old one passes", () => {
	const tags = findTags(
		fixture({
			"a.feature": "@quarantine #1\n@quarantine #2\n@quarantine #3\n",
		}),
	);
	const issues = {
		1: { state: "CLOSED", createdAt: day(1) },
		2: { state: "OPEN", createdAt: day(14) },
		3: { state: "OPEN", createdAt: day(13) },
	};
	assert.deepEqual(check(tags, { issue: (n) => issues[n], now: NOW }), [
		"a.feature:1: #1 is closed; remove the tag or open a new issue",
		"a.feature:2: #2 is 14 days old; the limit is 13. Fix the test or remove the tag",
	]);
});

test("an issue gh cannot read is an offence, not a pass", () => {
	const tags = findTags(fixture({ "a.feature": "@quarantine #9\n" }));
	const issue = () => {
		throw new Error("not found");
	};
	assert.deepEqual(check(tags, { issue, now: NOW }), [
		"a.feature:1: #9 could not be read",
	]);
});

test("the repository's own e2e tree passes with its current tags", () => {
	const root = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"packages",
		"frontend",
		"e2e",
	);
	const tags = findTags(root);
	assert.deepEqual(check(tags, { issue: openIssue, now: NOW }), []);
});
