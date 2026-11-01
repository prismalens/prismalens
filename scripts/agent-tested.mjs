#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Moves each registry row's `tested` to the pins CI installs, for the rolling pin-bump PR
 * (#914), so `harness-pins.test.ts` holds once the bump's CI is green. A moved row says no
 * real-model run backs it yet; the PR's recording checkbox is that run.
 *
 *   agent-tested.mjs [--date YYYY-MM-DD]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(
	ROOT,
	"packages/@prismalens/config/src/providers/harness.ts",
);
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

export function wanted(pins, adapters) {
	return {
		opencode: { version: pins["opencode-ai"] },
		"claude-code": {
			version: adapters["@agentclientprotocol/claude-agent-acp"],
			companion: pins["@anthropic-ai/claude-code"],
		},
		codex: {
			version: adapters["@agentclientprotocol/codex-acp"],
			companion: pins["@openai/codex"],
		},
	};
}

/** Returns the source with every row in `rows` tested on its wanted versions, and the ids it moved. */
export function retest(source, rows, date) {
	const lines = source.split("\n");
	const start = lines.findIndex((l) => l.startsWith("const PRODUCT"));
	const moved = [];
	for (const [id, want] of Object.entries(rows)) {
		const row = lines.findIndex(
			(l, i) => i > start && new RegExp(`^\\t"?${id}"?: \\{$`).test(l),
		);
		const at = lines.findIndex((l, i) => i > row && /^\t\ttested: \{/.test(l));
		if (row < 0 || at < 0) throw new Error(`no tested line for the ${id} row`);
		const field = (k) => new RegExp(`${k}: "([^"]*)"`).exec(lines[at])?.[1];
		if (
			field("version") === want.version &&
			field("companion") === want.companion
		)
			continue;
		const companion = want.companion ? `, companion: "${want.companion}"` : "";
		lines[at] =
			`\t\ttested: { version: "${want.version}", date: "${date}"${companion} },`;
		const note = `\t\t// The pin-bump PR moved this on ${date}: zero-token probe and aimock CI, no real-model run yet (#914).`;
		if (/^\t\t\/\//.test(lines[at - 1])) lines[at - 1] = note;
		else lines.splice(at, 0, note);
		moved.push(id);
	}
	return { source: lines.join("\n"), moved };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { values } = parseArgs({ options: { date: { type: "string" } } });
	const date = values.date ?? new Date().toISOString().slice(0, 10);
	const rows = wanted(
		json("scripts/agent-pins.json").pins,
		json("packages/@prismalens/agent-adapters/package.json").devDependencies,
	);
	const { source, moved } = retest(readFileSync(HARNESS, "utf8"), rows, date);
	writeFileSync(HARNESS, source);
	console.log(
		moved.length
			? `tested moved on ${moved.join(", ")}`
			: "every tested row already follows its pins",
	);
}
