#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Runs each built single-file adapter and completes an ACP initialize, so a bundle that
// lost a runtime file fails here, not in a user's run (#906). Needs `pnpm build` first.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { shippedAdapter, shippedVersion } from "../dist/index.js";
import { packageRootOf } from "./bundle.mjs";

const PKG_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundled = JSON.parse(
	readFileSync(join(PKG_DIR, "dist", "adapters", "bundled.json"), "utf8"),
);
const { devDependencies } = JSON.parse(
	readFileSync(join(PKG_DIR, "package.json"), "utf8"),
);

// codex-acp starts `codex app-server` during initialize: a stand-in answers every JSONL request.
const STAND_IN = [
	'import { createInterface } from "node:readline";',
	'createInterface({ input: process.stdin }).on("line", (line) => {',
	"	const { id, method } = JSON.parse(line);",
	"	if (id !== undefined && method) process.stdout.write(JSON.stringify({ id, result: {} }) + String.fromCharCode(10));",
	"});",
].join("\n");

function codexStandIn() {
	const dir = mkdtempSync(join(tmpdir(), "codex-stand-in-"));
	const script = join(dir, "app-server.mjs");
	writeFileSync(script, STAND_IN);
	if (process.platform === "win32") {
		const cmd = join(dir, "codex.cmd");
		writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`);
		return cmd;
	}
	const sh = join(dir, "codex");
	writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
	chmodSync(sh, 0o755);
	return sh;
}

test("packageRootOf finds the package of a metafile input, scoped or not", () => {
	assert.equal(
		packageRootOf(
			"../../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/index.js",
		),
		"../../../node_modules/.pnpm/zod@4.6.5/node_modules/zod",
	);
	assert.equal(
		packageRootOf("node_modules/@agentclientprotocol/sdk/dist/acp.js"),
		"node_modules/@agentclientprotocol/sdk",
	);
	assert.equal(packageRootOf("src/index.ts"), null);
});

for (const [pkg, { script, version }] of Object.entries(bundled)) {
	test(`${pkg} is shipped at its pin and answers ACP initialize`, async () => {
		assert.equal(version, devDependencies[pkg]);
		assert.equal(shippedVersion(pkg), devDependencies[pkg]);
		assert.equal(
			shippedAdapter(pkg),
			join(PKG_DIR, "dist", "adapters", script),
		);

		// claude-agent-acp does not start its companion during initialize.
		const child = spawn(process.execPath, [shippedAdapter(pkg)], {
			env: {
				...process.env,
				CLAUDE_CODE_EXECUTABLE: process.execPath,
				CODEX_PATH: codexStandIn(),
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (c) => {
			stderr += c;
		});
		try {
			const connection = new ClientSideConnection(
				() => ({
					requestPermission: async () => ({
						outcome: { outcome: "cancelled" },
					}),
					sessionUpdate: async () => {},
				}),
				ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
			);
			const exited = new Promise((_, reject) =>
				child.on("exit", (code) =>
					reject(new Error(`${pkg} exited ${code}: ${stderr.slice(-2000)}`)),
				),
			);
			const timeout = new Promise((_, reject) =>
				setTimeout(
					() =>
						reject(
							new Error(`no initialize reply in 20 s: ${stderr.slice(-2000)}`),
						),
					20_000,
				).unref(),
			);
			const reply = await Promise.race([
				connection.initialize({
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {},
				}),
				exited,
				timeout,
			]);
			assert.equal(typeof reply.protocolVersion, "number");
		} finally {
			child.kill();
		}
	});
}
