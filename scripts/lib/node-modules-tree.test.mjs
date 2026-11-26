// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests the agent SDK checks in scripts/lib/node-modules-tree.mjs (#1269).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentSdkProblems, nativeCopies } from "./node-modules-tree.mjs";

const SDK = "@anthropic-ai/claude-agent-sdk";

function writePackage(dir, manifest, files = {}) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
	for (const [name, body] of Object.entries(files))
		writeFileSync(join(dir, name), body);
}

/** An installed app: its manifest names the SDK, engine sits under node_modules/@prismalens. */
function installedApp({ sdkSource }) {
	const app = mkdtempSync(join(tmpdir(), "node-modules-tree-test-"));
	writePackage(app, { name: "prismalens", dependencies: { [SDK]: "0.3.328" } });
	writePackage(join(app, "node_modules", "@prismalens", "engine"), {
		name: "@prismalens/engine",
		type: "module",
	});
	if (sdkSource !== undefined)
		writePackage(
			join(app, "node_modules", ...SDK.split("/")),
			{ name: SDK, type: "module", exports: { ".": { default: "./sdk.mjs" } } },
			{ "sdk.mjs": sdkSource },
		);
	return app;
}

test("nativeCopies finds an agent native copy npm nested under another package", () => {
	const app = installedApp({ sdkSource: "export function query() {}" });
	try {
		writePackage(
			join(
				app,
				"node_modules",
				"some-dep",
				"node_modules",
				"@anthropic-ai",
				"claude-agent-sdk-linux-x64",
			),
			{ name: "@anthropic-ai/claude-agent-sdk-linux-x64" },
		);
		writePackage(join(app, "node_modules", "@openai", "codex-win32-x64"), {
			name: "@openai/codex-win32-x64",
		});
		assert.deepEqual(nativeCopies(app).sort(), [
			"node_modules/@openai/codex-win32-x64",
			"node_modules/some-dep/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64",
		]);
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
});

test("agentSdkProblems is empty for the SDK alone, loading with its query export", () => {
	const app = installedApp({ sdkSource: "export function query() {}" });
	try {
		assert.deepEqual(agentSdkProblems(app), []);
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
});

test("agentSdkProblems reports a native copy and an SDK engine cannot load", () => {
	const app = installedApp({ sdkSource: undefined });
	try {
		writePackage(
			join(
				app,
				"node_modules",
				"@anthropic-ai",
				"claude-agent-sdk-darwin-arm64",
			),
			{ name: "@anthropic-ai/claude-agent-sdk-darwin-arm64" },
		);
		const problems = agentSdkProblems(app);
		assert.equal(problems.length, 2);
		assert.equal(
			problems[0],
			"npm installed a native agent copy: node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64",
		);
		assert.match(
			problems[1],
			/^@anthropic-ai\/claude-agent-sdk does not load from engine: .*Cannot find module '@anthropic-ai\/claude-agent-sdk'/,
		);
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
});

test("agentSdkProblems reports an SDK without its query export", () => {
	const app = installedApp({ sdkSource: "export const other = 1;" });
	try {
		assert.equal(agentSdkProblems(app).length, 1);
		assert.match(
			agentSdkProblems(app)[0],
			/does not load from engine: .*the SDK has no query export/,
		);
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
});

test("agentSdkProblems skips the load check for an app that does not ship the SDK", () => {
	const app = mkdtempSync(join(tmpdir(), "node-modules-tree-test-"));
	try {
		writePackage(app, { name: "prismalens", dependencies: {} });
		assert.deepEqual(agentSdkProblems(app), []);
	} finally {
		rmSync(app, { recursive: true, force: true });
	}
});
