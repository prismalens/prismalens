// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

// Spawns Biome, which loads its plugins cold; the 3x rule would leave it 1 s, too tight for a slow runner.
vi.setConfig({ testTimeout: 10_000 });

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Biome on the rule fixtures: `file:line` of every plugin diagnostic. */
function flagged(): string[] {
	let out: string;
	try {
		out = execFileSync(
			process.execPath,
			[
				join(ROOT, "node_modules/@biomejs/biome/bin/biome"),
				"lint",
				"--config-path=tools/lint/fixtures.biome.json",
				"--max-diagnostics=100",
				"tools/lint/fixtures",
			],
			{ cwd: ROOT, encoding: "utf8", stdio: "pipe" },
		);
	} catch (e) {
		const { stdout, stderr } = e as { stdout: string; stderr: string };
		out = `${stdout}\n${stderr}`;
	}
	return [...out.matchAll(/fixtures.([\w.-]+):(\d+):\d+ plugin/g)].map(
		(m) => `${m[1]}:${m[2]}`,
	);
}

it("no-direct-clock flags each direct clock, timer and kill call, and nothing it allows (#1154)", () => {
	expect(flagged().filter((f) => f.startsWith("direct-clock.ts"))).toEqual([
		"direct-clock.ts:2",
		"direct-clock.ts:3",
		"direct-clock.ts:4",
		"direct-clock.ts:5",
		"direct-clock.ts:6",
		"direct-clock.ts:7",
		"direct-clock.ts:8",
	]);
});

it("small-spec-no-child-process flags a value import of child_process, not a type import (#1154)", () => {
	expect(
		flagged().filter((f) => f.startsWith("small-spec-child-process.ts")),
	).toEqual(["small-spec-child-process.ts:2", "small-spec-child-process.ts:3"]);
});
