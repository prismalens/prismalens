// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	diffSection,
	hunks,
	moveProbed,
	pinnedAt,
	stale,
} from "./agent-facts.mjs";

const AGENTS = readFileSync(
	new URL(
		"../packages/@prismalens/agent-host/src/registry/agents.ts",
		import.meta.url,
	),
	"utf8",
);

const fact = (via, cli, adapter) => ({
	value: true,
	via,
	verifiedAt: { cli, adapter },
});
/** A copy of `staleFacts` from the agent host, so this test needs no build. */
const staleFacts = (facts, at, via) =>
	Object.entries(facts ?? {})
		.filter(([, f]) => !via || f.via === via)
		.filter(
			([, f]) =>
				f.verifiedAt.cli !== at.cli || f.verifiedAt.adapter !== at.adapter,
		)
		.map(
			([name, f]) =>
				`${name} (${f.via}, checked on cli ${f.verifiedAt.cli}${f.verifiedAt.adapter ? `, adapter ${f.verifiedAt.adapter}` : ""})`,
		);

const registry = {
	"claude-code": {
		id: "claude-code",
		channel: { npm: "@anthropic-ai/claude-code" },
		adapterPackage: "@agentclientprotocol/claude-agent-acp",
		facts: {
			images: fact("probe", "2.1.318", "0.100.0"),
			subagentsOnStop: {
				...fact("source", "2.1.318", "0.99.0"),
				where: "src/acp-agent.ts cancel",
			},
		},
	},
	gemini: {
		id: "gemini",
		channel: { npm: "@google/gemini-cli" },
		facts: { images: fact("probe", "0.65.0", null) },
	},
	local: { id: "local" },
};
const pins = {
	"@anthropic-ai/claude-code": "2.1.318",
	"@google/gemini-cli": "0.65.0",
};
const adapters = { "@agentclientprotocol/claude-agent-acp": "0.100.0" };

test("a row's facts are due on its CLI pin and, for an adapter row, its adapter pin", () => {
	assert.deepEqual(
		[
			pinnedAt(registry["claude-code"], pins, adapters),
			pinnedAt(registry.gemini, pins, adapters),
			pinnedAt(registry.local, pins, adapters),
		],
		[
			{ cli: "2.1.318", adapter: "0.100.0" },
			{ cli: "0.65.0", adapter: null },
			null,
		],
	);
});

test("only a fact checked on other versions than its row's pins is stale, with the file it was read in", () => {
	const rows = stale(registry, pins, adapters, staleFacts);
	assert.deepEqual(
		rows.map(({ id, facts }) => [id, facts]),
		[
			[
				"claude-code",
				["subagentsOnStop (source, checked on cli 2.1.318, adapter 0.99.0)"],
			],
		],
	);
	assert.equal(rows[0].defs.subagentsOnStop.where, "src/acp-agent.ts cancel");
});

test("moving probed versions rewrites only the touched rows' PROBED_AT lines", () => {
	const { source, moved } = moveProbed(AGENTS, {
		"claude-code": { cli: "9.9.9", adapter: "8.8.8" },
		gemini: { cli: "7.7.7", adapter: null },
	});
	assert.deepEqual(moved, ["claude-code", "gemini"]);
	assert.ok(
		source.includes('\t"claude-code": { cli: "9.9.9", adapter: "8.8.8" },'),
	);
	assert.ok(source.includes('\tgemini: { cli: "7.7.7", adapter: null },'));
	const changed = source
		.split("\n")
		.filter((l, i) => l !== AGENTS.split("\n")[i]);
	assert.deepEqual(changed, [
		'\t"claude-code": { cli: "9.9.9", adapter: "8.8.8" },',
		'\tgemini: { cli: "7.7.7", adapter: null },',
	]);
});

test("rows already on their versions stay byte for byte, and a row with no line refuses", () => {
	const at = AGENTS.match(
		/^\topencode: \{ cli: "([^"]*)", adapter: null \},$/m,
	)?.[1];
	assert.deepEqual(
		moveProbed(AGENTS, { opencode: { cli: at, adapter: null } }),
		{ source: AGENTS, moved: [] },
	);
	assert.throws(
		() => moveProbed(AGENTS, { deepagents: { cli: "1", adapter: null } }),
		/no PROBED_AT line for the deepagents row/,
	);
});

const PATCH = [
	"@@ -1,3 +1,3 @@",
	" const a = 1;",
	"-const b = 2;",
	"+const b = 3;",
	"@@ -10,3 +10,4 @@ class Agent {",
	"   async cancel(params) {",
	"+    this.subagents.stopAll();",
	"   }",
	"@@ -20,2 +21,2 @@",
	"-  // the session ends here",
	"+  // it ends here",
].join("\n");

test("hunks keeps those whose changed lines touch cancel, session or sub-agent code, not context lines", () => {
	assert.deepEqual(hunks(PATCH), [
		"@@ -10,3 +10,4 @@ class Agent {\n   async cancel(params) {\n+    this.subagents.stopAll();\n   }",
		"@@ -20,2 +21,2 @@\n-  // the session ends here\n+  // it ends here",
	]);
});

test("a diff section lists matching files, skips tests and lockfiles, and says when there is no source", () => {
	const files = [
		{ filename: "src/acp-agent.ts", patch: PATCH },
		{ filename: "src/acp-agent.test.ts", patch: PATCH },
		{ filename: "package-lock.json", patch: PATCH },
		{ filename: "README.md", patch: "@@ -1 +1 @@\n-old\n+new" },
	];
	const out = diffSection(
		"@agentclientprotocol/claude-agent-acp",
		"0.99.0",
		"0.100.0",
		files,
		"https://example.test/compare",
	);
	assert.match(
		out,
		/^#### `@agentclientprotocol\/claude-agent-acp` 0\.99\.0 → 0\.100\.0: hunks touching cancel, session or sub-agent code$/m,
	);
	assert.match(
		out,
		/^1 of 4 changed files match\. Full diff: https:\/\/example\.test\/compare$/m,
	);
	assert.deepEqual(
		[...out.matchAll(/<code>([^<]+)<\/code>: (\d+) hunks?/g)].map((m) => [
			m[1],
			m[2],
		]),
		[["src/acp-agent.ts", "2"]],
	);
	assert.equal(
		diffSection("@anthropic-ai/claude-code", "2.1.317", "2.1.318", null),
		"#### `@anthropic-ai/claude-code` 2.1.317 → 2.1.318: hunks touching cancel, session or sub-agent code\n\nNo public source to diff; read its release notes.",
	);
});

test("a diff section puts code before docs and shows at most four hunks a file, pointing to the rest", () => {
	const many = Array.from(
		{ length: 8 },
		(_, i) => `@@ -${i},1 +${i},1 @@\n-old cancel ${i}\n+new cancel ${i}`,
	).join("\n");
	const out = diffSection(
		"pkg",
		"1.0.0",
		"1.1.0",
		[
			{ filename: "CHANGELOG.md", patch: "@@ -1 +1 @@\n-x\n+fix session load" },
			{ filename: "src/agent.ts", patch: many },
		],
		"https://example.test/compare",
	);
	assert.deepEqual(
		[...out.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1]),
		["src/agent.ts", "CHANGELOG.md"],
	);
	assert.equal((out.match(/^\+new cancel \d$/gm) ?? []).length, 4);
	assert.match(out, /^4 more in the compare\.$/m);
});
