// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Answers session/new only after `authenticate`, as Antigravity 1.5.2 does; LOG gets each method id (#1235).
// GATE=hang never answers `authenticate`, as a signed-out agent waiting on its browser sign-in.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
let method = null;

createInterface({ input: process.stdin }).on("line", (line) => {
	if (!line.trim()) return;
	const msg = JSON.parse(line);
	if (msg.method === "initialize")
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: 1,
				agentInfo: { name: "gate", version: "1" },
				authMethods: [
					{ id: "oauth-personal", name: "Log in with Google" },
					{ id: "gemini-api-key", name: "Gemini API key" },
				],
			},
		});
	else if (msg.method === "authenticate") {
		method = msg.params.methodId;
		appendFileSync(process.env.LOG, `${method}\n`);
		if (process.env.GATE !== "hang")
			send({ jsonrpc: "2.0", id: msg.id, result: {} });
	} else if (msg.method === "session/new")
		send(
			method
				? { jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }
				: {
						jsonrpc: "2.0",
						id: msg.id,
						error: { code: -32000, message: "Authentication required" },
					},
		);
});
