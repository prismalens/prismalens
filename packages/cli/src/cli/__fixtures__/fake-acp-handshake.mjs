#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
//
// Minimal ACP handshake stub for `doctor.test.ts`: `initialize` + `session/new`
// only, no prompt turn — `checkHarnessReadiness` never sends one, so nothing
// else needs to be faked. FAKE_ACP_MODE: "ok" or "unauthenticated" (exits
// immediately with a stderr line, the same shape a not-logged-in harness
// exits with).
import { createInterface } from "node:readline";

const mode = process.env.FAKE_ACP_MODE ?? "ok";

if (mode === "unauthenticated") {
	process.stderr.write("Error: not logged in\n");
	process.exit(1);
}

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
			result: { protocolVersion: 1, agentInfo: { name: "fake", version: "0" } },
		});
	} else if (msg.method === "session/new") {
		send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
	}
});
