// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests scripts/lib/agent-sdk-probe.mjs (#1269).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	adapterImports,
	checkSignedOut,
	SYMBOL_TYPES,
	symbolProblems,
} from "./agent-sdk-probe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SDK = "@anthropic-ai/claude-agent-sdk";

/** A built adapter that imports `source`, beside an SDK stub exporting `stub`. */
function fixture(source, stub) {
	const root = mkdtempSync(join(tmpdir(), "agent-sdk-probe-test-"));
	const adapters = join(root, "adapters");
	mkdirSync(adapters);
	writeFileSync(join(adapters, "claude-agent-acp.mjs"), source);
	writeFileSync(join(adapters, "notes.txt"), `import { query } from "${SDK}"`);
	const sdk = join(root, "node_modules", ...SDK.split("/"));
	mkdirSync(sdk, { recursive: true });
	writeFileSync(
		join(sdk, "package.json"),
		JSON.stringify({
			name: SDK,
			type: "module",
			exports: { ".": "./sdk.mjs" },
		}),
	);
	writeFileSync(join(sdk, "sdk.mjs"), stub);
	return { root, adapters, from: join(adapters, "claude-agent-acp.mjs") };
}

test("adapterImports reads every named import from the SDK, aliases resolved, in .mjs files only", () => {
	const { root, adapters, from } = fixture(
		`import { query, listSessions as listSessions2 } from "${SDK}"\n` +
			`import {\n  USAGE_LIMIT_ERROR_PREFIXES,\n} from '${SDK}';\n` +
			`import { other } from "${SDK}-extra"\n`,
		"",
	);
	try {
		assert.deepEqual(
			[...adapterImports(adapters).entries()].map(([f, n]) => [f, [...n]]),
			[[from, ["query", "listSessions", "USAGE_LIMIT_ERROR_PREFIXES"]]],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("symbolProblems names a symbol of the wrong type and one with no listed type", async () => {
	const { root, from } = fixture(
		"",
		"export const query = 1; export const USAGE_LIMIT_ERROR_PREFIXES = []; export function brandNew() {}",
	);
	try {
		const { problems } = await symbolProblems(from, [
			"query",
			"USAGE_LIMIT_ERROR_PREFIXES",
			"brandNew",
			"listSessions",
		]);
		assert.deepEqual(problems, [
			"USAGE_LIMIT_ERROR_PREFIXES: expected string[], got array",
			"brandNew: imported but has no type in SYMBOL_TYPES",
			"listSessions: expected function, got undefined",
			"query: expected function, got number",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("symbolProblems passes the workspace SDK's own exports for every listed symbol", async () => {
	const { problems } = await symbolProblems(
		join(ROOT, "packages", "@prismalens", "agent-adapters", "package.json"),
		Object.keys(SYMBOL_TYPES),
	);
	assert.deepEqual(problems, []);
});

test("checkSignedOut drives accountInfo and the usage call of the workspace SDK against the fake agent", async () => {
	const { sdk } = await symbolProblems(
		join(ROOT, "packages", "@prismalens", "agent-adapters", "package.json"),
		["query"],
	);
	await checkSignedOut(sdk.query);
});
