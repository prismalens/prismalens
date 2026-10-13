#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
//
// Minimal ACP handshake stub for `doctor.test.ts`: `initialize` + `session/new`
// only, no prompt turn — `checkHarnessReadiness` never sends one, so nothing
// else needs to be faked. FAKE_ACP_MODE: "ok", "served" or "unauthenticated" (exits
// immediately with a stderr line, the same shape a not-logged-in harness
// exits with); "signed-out" and "signed-in" push `_auth/status_update` after
// session/new, as claude-agent-acp 0.81.1 does from its own CLI probe.
import { createInterface } from "node:readline";

const mode = process.env.FAKE_ACP_MODE ?? "ok";

if (mode === "unauthenticated") {
	process.stderr.write("Error: not logged in\n");
	process.exit(1);
}

const authKind = { "signed-out": "none", "signed-in": "account" }[mode];
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	if (msg.method === "initialize") {
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: 1,
				agentInfo: { name: "fake", version: "0" },
				...(authKind
					? { agentCapabilities: { _meta: { authStatus: {} } } }
					: {}),
			},
		});
	} else if (msg.method === "session/new") {
		// "served": the agent names its current model, as OpenCode does with no provider signed in.
		const configOptions =
			mode === "served"
				? [
						{
							id: "model",
							name: "Model",
							category: "model",
							type: "select",
							currentValue: "opencode/big-pickle",
							options: [{ value: "opencode/big-pickle", name: "Big Pickle" }],
						},
					]
				: undefined;
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: { sessionId: "s1", ...(configOptions ? { configOptions } : {}) },
		});
		if (authKind)
			setTimeout(
				() =>
					send({
						jsonrpc: "2.0",
						method: "_auth/status_update",
						params: { authStatus: { kind: authKind, label: "fake" } },
					}),
				50,
			);
	}
});
