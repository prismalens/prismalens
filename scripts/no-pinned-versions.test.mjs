// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A test that names a live pin's version breaks on the next bump (#966, #1071, #1204), so no
// test on an agent path may: read the pin from its pin.json, or use a fixture version.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { agentPins, ROOT } from "./agent-pins.mjs";

/** Where a test's subject is an agent, its pins or its facts. */
export const AGENT_TEST_DIRS = [
	"packages/@prismalens/agent-host/src",
	"packages/@prismalens/agent-adapters/src",
	"packages/@prismalens/config/src/providers",
	"packages/@prismalens/engine/scripts",
	"packages/@prismalens/providers/src",
	"scripts",
];
const TEST = /\.(test|spec)\.(m?[jt]s|tsx)$/;
// Only scripts that are about agents; the rest of scripts/ is other subjects.
const SCRIPT_TEST = /^scripts\/(agent-|no-pinned-versions)/;

/** Every version a bump moves: each CLI, adapter and tested version, and the adapters pnpm installs. */
export function liveVersions(root = ROOT) {
	const adapters = JSON.parse(
		readFileSync(
			join(root, "packages/@prismalens/agent-adapters/package.json"),
			"utf8",
		),
	).devDependencies;
	const out = new Set();
	for (const p of agentPins(root)) {
		out.add(p.cli.version);
		if (p.adapter) out.add(p.adapter.version);
		if (p.tested) out.add(p.tested.version);
	}
	for (const [name, v] of Object.entries(adapters))
		if (name.startsWith("@agentclientprotocol/")) out.add(v);
	return out;
}

/** Each `file:line "version"` where a live version appears, alone or inside a string. */
export function pinnedLiterals(files, versions) {
	const hits = [];
	for (const [file, text] of files)
		text.split("\n").forEach((line, i) => {
			for (const m of line.matchAll(/(?<![\d.])(\d+\.\d+\.\d+)(?![\d.])/g))
				if (versions.has(m[1])) hits.push(`${file}:${i + 1} "${m[1]}"`);
		});
	return hits;
}

function testFiles(dir) {
	const out = [];
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			if (
				e.name === "node_modules" ||
				e.name === "dist" ||
				e.name === "fixtures"
			)
				continue;
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (TEST.test(e.name))
				out.push(relative(ROOT, p).split("\\").join("/"));
		}
	};
	walk(join(ROOT, dir));
	return out;
}

test("no agent test names a live pin's version (class T)", () => {
	const files = AGENT_TEST_DIRS.flatMap(testFiles)
		.filter((f) => !f.startsWith("scripts/") || SCRIPT_TEST.test(f))
		.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]);
	assert.deepEqual(
		files.map(([f]) => f).filter((f) => f.endsWith("/acp-scenarios.test.ts")),
		["packages/@prismalens/engine/scripts/acp-scenarios.test.ts"],
	);
	assert.deepEqual(pinnedLiterals(files, liveVersions()), []);
});

test("the guard catches #966's shape: a pinned version alone or inside a string, never a longer one", () => {
	const versions = new Set(["1.2.3"]);
	assert.deepEqual(
		pinnedLiterals(
			[
				[
					"a.test.ts",
					'expect(pin).toBe("1.2.3");\nexpect(x).toBe("9.9.9");\nexpect(text).toBe("gemini 1.2.3 answers");\nexpect(y).toBe("11.2.3");',
				],
			],
			versions,
		),
		['a.test.ts:1 "1.2.3"', 'a.test.ts:3 "1.2.3"'],
	);
});
