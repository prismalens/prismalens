// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const report = (files) => JSON.stringify({ schemaVersion: "1.0", files });
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
		report({
			"src/a.ts": { mutants: [mutant("Killed", 1), mutant("Survived", 7)] },
			"src/b.ts": { mutants: [mutant("Survived", 3)] },
		}),
	);
	assert.deepEqual(found, [
		{ file: "src/a.ts", line: 7, mutator: "ConditionalExpression" },
		{ file: "src/b.ts", line: 3, mutator: "ConditionalExpression" },
	]);
});

// Written by Stryker 10.1.1's own json reporter over a file with `a <` + ` b` and `x > 0 && x < 10`.
test("survivors reads a report Stryker 10.1.1 wrote, mutants of a comparison and a split string included", () => {
	const real = readFileSync(
		new URL("./fixtures/stryker-10.1.1-mutation.json", import.meta.url),
		"utf8",
	);
	const found = survivors(real);
	assert.equal(found.length, 18);
	assert.deepEqual(found[3], {
		file: "src/a.js",
		line: 1,
		mutator: "EqualityOperator",
	});
	assert.deepEqual(found.at(-1), {
		file: "src/a.js",
		line: 2,
		mutator: "EqualityOperator",
	});
});

test("a file that is not a Stryker JSON report throws", () => {
	assert.throws(() => survivors("{}"), /not a Stryker JSON report/);
});

test("every stryker config writes the JSON report the summary reads, where it is uploaded from", () => {
	const root = new URL("../packages/", import.meta.url);
	for (const pkg of ["@prismalens/auth", "@prismalens/engine", "api"]) {
		const config = readFileSync(
			new URL(`${pkg}/stryker.config.mjs`, root),
			"utf8",
		);
		assert.match(config, /reporters: \[[^\]]*"json"/, pkg);
		assert.doesNotMatch(config, /jsonReporter/, pkg);
	}
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
		join(dir, "reports", "mutation-0", "mutation.json"),
		report({ "src/a.ts": { mutants: [mutant("Survived", 9)] } }),
	);
	writeFileSync(
		join(dir, "jobs.json"),
		JSON.stringify({
			jobs: [
				job("stryker (@prismalens/api, x)", "success", "success"),
				job("stryker (@prismalens/auth)", "failure", "failure"),
			],
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
