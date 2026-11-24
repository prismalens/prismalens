// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildBatch,
	classify,
	main,
	survivors,
	TITLE,
} from "./mutation-report.mjs";

const job = (name, conclusion, stryker) => ({
	name,
	conclusion,
	html_url: `https://x/${encodeURIComponent(name)}`,
	steps: stryker
		? [{ name: "Run Stryker", conclusion: stryker }]
		: [{ name: "Set up job", conclusion: "success" }],
});
const html = (files) =>
	`<html><script>document.querySelector("x").report = ${JSON.stringify({ files })};</script></html>`;
const mutant = (status, line) => ({
	status,
	mutatorName: "ConditionalExpression",
	location: { start: { line } },
});

test("a failed Stryker step is a red shard; a failure with no Stryker step is infra", () => {
	const { red, infra } = classify([
		job("stryker (@prismalens/api, dispatch 2)", "failure", "failure"),
		job("stryker (@prismalens/auth)", "failure", null),
		job("stryker (@prismalens/engine)", "cancelled", "cancelled"),
		job("stryker (@prismalens/api, harness-receipt)", "success", "success"),
		job("Mutation report", "failure", null),
	]);
	assert.deepEqual(
		red.map((j) => j.name),
		["stryker (@prismalens/api, dispatch 2)"],
	);
	assert.deepEqual(
		infra.map((j) => j.name),
		["stryker (@prismalens/auth)", "stryker (@prismalens/engine)"],
	);
});

test("survivors reads only Survived mutants, with file and line", () => {
	const found = survivors(
		html({
			"src/a.ts": { mutants: [mutant("Killed", 1), mutant("Survived", 7)] },
			"src/b.ts": { mutants: [mutant("Survived", 3)] },
		}),
	);
	assert.deepEqual(found, [
		{ file: "src/a.ts", line: 7, mutator: "ConditionalExpression" },
		{ file: "src/b.ts", line: 3, mutator: "ConditionalExpression" },
	]);
});

test("a report with no embedded JSON throws", () => {
	assert.throws(() => survivors("<html></html>"), /no embedded report/);
});

test("a clean run is ok; a survivor, a red shard or an infra loss is not", () => {
	const clean = {
		survived: [],
		red: [],
		infra: [],
		runUrl: "u",
		lostReports: 0,
	};
	assert.equal(buildBatch(clean)[0].ok, true);
	assert.equal(
		buildBatch({
			...clean,
			survived: [{ file: "a", line: 1, mutator: "m" }],
		})[0].ok,
		false,
	);
	assert.equal(
		buildBatch({ ...clean, red: [{ name: "n", url: "u" }] })[0].ok,
		false,
	);
	assert.equal(
		buildBatch({ ...clean, infra: [{ name: "n", url: "u" }] })[0].ok,
		false,
	);
});

test("the body names infra apart from red shards", () => {
	const [{ body, title }] = buildBatch({
		survived: [],
		red: [{ name: "R", url: "ur" }],
		infra: [{ name: "I", url: "ui" }],
		runUrl: "https://run",
		lostReports: 0,
	});
	assert.equal(title, TITLE);
	assert.match(body, /Red shards \(Stryker failed\):\n- R ur/);
	assert.match(body, /Infra, not a test finding .*:\n- I ui/);
});

test("main joins the jobs file and the shards' reports", () => {
	const dir = mkdtempSync(join(tmpdir(), "mut-"));
	mkdirSync(join(dir, "reports", "mutation-0"), { recursive: true });
	writeFileSync(
		join(dir, "reports", "mutation-0", "index.html"),
		html({ "src/a.ts": { mutants: [mutant("Survived", 9)] } }),
	);
	writeFileSync(
		join(dir, "jobs.json"),
		JSON.stringify({
			jobs: [job("stryker (@prismalens/api, x)", "success", "success")],
		}),
	);
	const [{ body, ok }] = main([
		join(dir, "reports"),
		join(dir, "jobs.json"),
		"https://run",
	]);
	assert.equal(ok, false);
	assert.match(
		body,
		/Survived mutants: 1\n- `src\/a.ts:9` ConditionalExpression/,
	);
});
