#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
//
// A fake ACP agent for engine tests. Speaks protocol v1 over stdio. Behaviour is
// picked by FAKE_ACP_MODE: "ok" (valid report first try), "retry" (invalid then
// valid), "never" (never valid), "crash" (exit mid-turn), "nowrite" (no tool
// runs). It always attempts one read-only shell call and one write, and reports
// what the client decided for each so the test can assert the gate.
import { createInterface } from "node:readline";

const mode = process.env.FAKE_ACP_MODE ?? "ok";
const cwd = process.cwd();
let nextId = 100;
const pending = new Map();
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const notify = (sessionId, update) =>
	send({
		jsonrpc: "2.0",
		method: "session/update",
		params: { sessionId, update },
	});
const ask = (params) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		send({ jsonrpc: "2.0", id, method: "session/request_permission", params });
	});

const report = {
	summary: `fake run in ${cwd} (${process.env.FAKE_MARKER ?? "no-marker"})`,
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [
		{
			statement: "connection pool exhausted",
			status: "supported",
			evidence: [
				{
					observation: "pool size 5",
					source: "cat config.yml",
					direction: "supports",
					status: "verified",
				},
			],
		},
	],
	ruledOut: [],
	coverage: { queried: ["pwd"], notQueried: ["prometheus"] },
	nextSteps: [
		{ title: "raise pool size", detail: "config.yml", priority: "high" },
	],
};

let turns = 0;
async function turn(sessionId, promptText) {
	turns += 1;
	if (mode === "crash") process.exit(3);
	if (turns === 1 && mode !== "nowrite") {
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Checking the tree. " },
		});
		notify(sessionId, {
			sessionUpdate: "tool_call",
			toolCallId: "t1",
			title: "pwd",
			kind: "execute",
			status: "pending",
			rawInput: { command: "pwd" },
		});
		const a = await ask({
			sessionId,
			toolCall: {
				toolCallId: "t1",
				title: "pwd",
				kind: "execute",
				rawInput: { command: "pwd" },
			},
			options: [
				{ optionId: "once", name: "Allow once", kind: "allow_once" },
				{ optionId: "always", name: "Always", kind: "allow_always" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" },
			],
		});
		notify(sessionId, {
			sessionUpdate: "tool_call_update",
			toolCallId: "t1",
			status: a.outcome?.optionId === "once" ? "completed" : "failed",
			content: [
				{
					type: "content",
					content: {
						type: "text",
						text: a.outcome?.optionId === "once" ? cwd : "denied",
					},
				},
			],
		});
		notify(sessionId, {
			sessionUpdate: "tool_call",
			toolCallId: "t2",
			title: "echo spike > PRISMALENS_SPIKE.txt",
			kind: "execute",
			status: "pending",
			rawInput: { command: "echo spike > PRISMALENS_SPIKE.txt" },
		});
		const w = await ask({
			sessionId,
			toolCall: {
				toolCallId: "t2",
				title: "echo spike > PRISMALENS_SPIKE.txt",
				kind: "execute",
				rawInput: { command: "echo spike > PRISMALENS_SPIKE.txt" },
			},
			options: [
				{ optionId: "once", kind: "allow_once" },
				{ optionId: "reject", kind: "reject_once" },
			],
		});
		const allowed = w.outcome?.optionId === "once";
		notify(sessionId, {
			sessionUpdate: "tool_call_update",
			toolCallId: "t2",
			status: allowed ? "completed" : "failed",
			content: [
				{
					type: "content",
					content: {
						type: "text",
						text: allowed ? "WROTE" : "The user rejected permission",
					},
				},
			],
		});
		process.stderr.write(`fake: write ${allowed ? "ALLOWED" : "refused"}\n`);
	}
	const valid =
		mode === "ok" || mode === "nowrite" || (mode === "retry" && turns >= 2);
	const body = valid ? JSON.stringify(report) : JSON.stringify({ summary: "" });
	const prefix = promptText.startsWith("Your final message did not")
		? "Corrected. "
		: "Done. ";
	notify(sessionId, {
		sessionUpdate: "agent_message_chunk",
		content: { type: "text", text: `${prefix}\n\`\`\`json\n${body}\n\`\`\`\n` },
	});
	return { stopReason: "end_turn" };
}

createInterface({ input: process.stdin }).on("line", async (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	if (msg.id !== undefined && pending.has(msg.id)) {
		pending.get(msg.id)(msg.result ?? {});
		pending.delete(msg.id);
		return;
	}
	if (msg.method === "initialize") {
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: { protocolVersion: 1, agentInfo: { name: "fake", version: "0" } },
		});
	} else if (msg.method === "session/new") {
		if (msg.params?.cwd !== cwd)
			process.stderr.write(`fake: session cwd ${msg.params?.cwd} != ${cwd}\n`);
		send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
	} else if (msg.method === "session/prompt") {
		const text = msg.params?.prompt?.[0]?.text ?? "";
		const result = await turn(msg.params.sessionId, text);
		send({ jsonrpc: "2.0", id: msg.id, result });
	} else if (msg.method === "session/cancel") {
		// ignored by the fake
	} else if (msg.id !== undefined) {
		send({ jsonrpc: "2.0", id: msg.id, result: {} });
	}
});
