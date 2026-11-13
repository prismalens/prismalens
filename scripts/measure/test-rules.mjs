// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Lying-tests lens (plan §4). Counting only.
//   lint        hits of T1 (bare assertion), T2 (expect in if/loop/mock), T3 (early return) from the ratchet
//   zero-match  vitest configs that pass with no tests, and Playwright invocations that do
//   mutation    the Stryker score per package from reports/mutation/mutation.json, when a report exists
//   thresholds  tagged cases (@cond:) that retype a threshold instead of importing it from the registry
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root, sh } from "./lib.mjs";

function lint() {
	const tsv = readFileSync(
		join(root, "packages/frontend/registry.ratchet.tsv"),
		"utf8",
	);
	const sum = { T1: 0, T2: 0, T3: 0 };
	for (const l of tsv.split("\n")) {
		const [, rule, n] = l.split("\t");
		if (rule in sum) sum[rule] += Number(n);
	}
	console.log(
		`tests.lint T1 ${sum.T1} T2 ${sum.T2} T3 ${sum.T3} (rows: packages/frontend/registry.ratchet.tsv; refresh with pnpm registry ratchet --write)`,
	);
}

function zeroMatch() {
	const files = sh("git", [
		"ls-files",
		"--",
		"*vitest.config.*",
		"*vitest.workspace.*",
		"*playwright.config.*",
		"package.json",
		"*/package.json",
		"*/*/package.json",
		".github/workflows/*.yml",
	])
		.split("\n")
		.filter(Boolean);
	const hits = [];
	for (const f of files) {
		readFileSync(join(root, f), "utf8")
			.split("\n")
			.forEach((l, i) => {
				if (
					/passWithNoTests\s*:\s*true|--pass-with-no-tests|--passWithNoTests/.test(
						l,
					)
				)
					hits.push(`${f}:${i + 1}: ${l.trim()}`);
			});
	}
	for (const h of hits) console.log(h);
	console.log(
		`tests.zero-match-pass ${hits.length} places let a run with no tests pass`,
	);
}

function mutation() {
	const dirs = [
		"packages/api",
		"packages/@prismalens/engine",
		"packages/@prismalens/auth",
		"packages/frontend",
	];
	for (const d of dirs) {
		const f = join(root, d, "reports/mutation/mutation.json");
		if (!existsSync(f)) {
			console.log(`tests.mutation ${d}: no report`);
			continue;
		}
		const files = Object.values(JSON.parse(readFileSync(f, "utf8")).files);
		const m = files.flatMap((x) => x.mutants.map((y) => y.status));
		const killed = m.filter((s) => s === "Killed" || s === "Timeout").length;
		const valid = m.filter(
			(s) => !["CompileError", "Ignored", "RuntimeError"].includes(s),
		).length;
		console.log(
			`tests.mutation ${d}: ${valid ? ((100 * killed) / valid).toFixed(1) : "n/a"}% (${killed}/${valid})`,
		);
	}
}

function thresholds() {
	const tagged = sh("git", ["grep", "-l", "@cond:", "--", "packages"])
		.split("\n")
		.filter(Boolean);
	const bad = tagged.filter(
		(f) =>
			!/from ["'][^"']*registry[^"']*["']/.test(
				readFileSync(join(root, f), "utf8"),
			),
	);
	for (const f of bad)
		console.log(`${f}: tagged @cond: without importing from the registry`);
	console.log(
		`tests.retyped-thresholds ${bad.length} of ${tagged.length} tagged files`,
	);
}

const cmd = process.argv[2];
const run = { lint, "zero-match": zeroMatch, mutation, thresholds }[cmd];
if (!run) {
	console.error(
		"usage: node scripts/measure/test-rules.mjs lint|zero-match|mutation|thresholds",
	);
	process.exit(2);
}
try {
	run();
} catch (e) {
	if (cmd === "thresholds" && e.status === 1)
		console.log("tests.retyped-thresholds 0 of 0 tagged files");
	else throw e;
}
