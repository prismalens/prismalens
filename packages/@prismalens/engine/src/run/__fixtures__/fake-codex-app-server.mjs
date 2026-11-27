#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
//
// A fake `codex app-server` for limit-read tests: newline JSON-RPC over stdio, no
// `jsonrpc` field, as codex 0.171.0's generated schema has it. FAKE_CODEX_MODE picks
// the answer to `account/rateLimits/read`: "ok" (one `codex` bucket), "buckets" (the
// `codex` bucket and a model bucket, by `rateLimitsByLimitId`), "free" (a free plan
// with no window durations), "error" (a JSON-RPC error) or "hang" (never answers it).
// FAKE_CODEX_ARGS writes this process's arguments there, one JSON array, so a test
// sees the `-c` overrides. `initialize` from any client but `prismalens` is refused.
// FAKE_CODEX_ANSWERS: a JSON object of method -> result, answered as given (What loads, #1180).
// `mcp list --json` prints FAKE_CODEX_MCP_LIST's names (or exits 1 for "fail"), writing its
// folder to FAKE_CODEX_MCP_CWD. FAKE_CODEX_HOLD: a method never answered; FAKE_CODEX_ASKED: each
// method asked is appended there; FAKE_CODEX_PID: this process's pid; FAKE_CODEX_IGNORE_TERM: it
// outlives SIGTERM.
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_CODEX_MODE ?? "ok";
const listing = process.argv[2] === "mcp";
if (listing) {
	if (process.env.FAKE_CODEX_MCP_CWD)
		writeFileSync(process.env.FAKE_CODEX_MCP_CWD, process.cwd());
	const names = process.env.FAKE_CODEX_MCP_LIST ?? "[]";
	if (names === "fail") process.exit(1);
	const list = JSON.parse(names).map((name) => ({ name, enabled: true }));
	process.stdout.write(JSON.stringify(list), () => process.exit(0));
} else if (process.env.FAKE_CODEX_ARGS)
	writeFileSync(
		process.env.FAKE_CODEX_ARGS,
		JSON.stringify(process.argv.slice(2)),
	);

if (!listing && process.env.FAKE_CODEX_PID)
	writeFileSync(process.env.FAKE_CODEX_PID, String(process.pid));
if (process.env.FAKE_CODEX_IGNORE_TERM) process.on("SIGTERM", () => {});
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
let initialized = false;

const codex = {
	limitId: "codex",
	limitName: null,
	planType: "plus",
	primary: {
		usedPercent: 42,
		windowDurationMins: 300,
		resetsAt: 1_800_000_000,
	},
	secondary: {
		usedPercent: 7,
		windowDurationMins: 10_080,
		resetsAt: 1_800_500_000,
	},
};
const model = {
	limitId: "gpt-6.2-sol-mini",
	limitName: "Sol mini",
	planType: "plus",
	primary: {
		usedPercent: 90,
		windowDurationMins: 300,
		resetsAt: 1_800_000_100,
	},
	secondary: null,
};
const free = {
	limitId: "codex",
	planType: "free",
	primary: { usedPercent: 100, resetsAt: 1_800_000_000 },
	secondary: null,
};

createInterface({ input: process.stdin }).on("line", (line) => {
	const msg = JSON.parse(line);
	if (process.env.FAKE_CODEX_ASKED)
		appendFileSync(process.env.FAKE_CODEX_ASKED, `${msg.method}\n`);
	if (msg.method === process.env.FAKE_CODEX_HOLD) return;
	if (msg.method === "initialized" && msg.id === undefined) {
		initialized = true;
		return;
	}
	if (msg.method === "initialize") {
		if (msg.params?.clientInfo?.name !== "prismalens")
			return send({
				id: msg.id,
				error: { code: -32600, message: "unknown client" },
			});
		return send({ id: msg.id, result: { userAgent: "codex_cli_rs/0.171.0" } });
	}
	if (!initialized)
		return send({
			id: msg.id,
			error: { code: -32002, message: "Not initialized" },
		});
	const answers = JSON.parse(process.env.FAKE_CODEX_ANSWERS ?? "{}");
	if (msg.method in answers)
		return send({ id: msg.id, result: answers[msg.method] });
	if (msg.method === "account/read")
		return send({
			id: msg.id,
			result: {
				account: {
					type: "chatgpt",
					email: "dev@example.test",
					planType: "plus",
					workspaceName: null,
				},
				requiresOpenaiAuth: true,
			},
		});
	if (msg.method === "account/rateLimits/read") {
		if (mode === "hang") return;
		if (mode === "error")
			return send({
				id: msg.id,
				error: { code: -32603, message: "usage unavailable" },
			});
		const snapshot = mode === "free" ? free : codex;
		return send({
			id: msg.id,
			result: {
				rateLimits: snapshot,
				rateLimitsByLimitId:
					mode === "buckets" ? { codex, [model.limitId]: model } : null,
			},
		});
	}
	send({
		id: msg.id,
		error: { code: -32601, message: `no method ${msg.method}` },
	});
});
