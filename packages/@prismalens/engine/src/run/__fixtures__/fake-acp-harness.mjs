#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
//
// A fake ACP agent for engine tests. Speaks protocol v1 over stdio. Behaviour is
// picked by FAKE_ACP_MODE: "ok" (valid report first try), "retry" (invalid then
// valid), "never" (never valid), "crash" (exit mid-turn), "nowrite" (no tool
// runs), "hang" (never answers the handshake — a doctor-probe timeout),
// "unauthenticated" (exits immediately with a stderr line), "print-env" (exits
// naming which of FAKE_ENV_PROBE's comma-separated vars it received), "tolerant"
// (emits unknown update kinds, unknown tool kinds, extra fields, and unknown stopReason),
// "steerable" (like "ok"; with FAKE_WAIT_CANCEL its first turn waits for session/cancel;
// later turns echo the prompt), "silent" (a turn that emits nothing until cancelled),
// "resume" (a turn answers `Heard: <prompt>` with no tool call; FAKE_LOAD_SESSION=1
// advertises loadSession and replays two updates before answering session/load),
// or "auth-required" (offers authMethods, then answers session/new with ACP's -32000). It always attempts one read-only shell call and one write,
// and reports what the client decided for each so the test can assert the gate.
import { createInterface } from "node:readline";

const mode = process.env.FAKE_ACP_MODE ?? "ok";
const cwd = process.cwd();

if (mode === "unauthenticated") {
	process.stderr.write("Error: not logged in\n");
	process.exit(1);
}
if (mode === "print-env") {
	const seen = (process.env.FAKE_ENV_PROBE ?? "")
		.split(",")
		.map((k) => `${k}=${process.env[k] === undefined ? "unset" : "set"}`);
	process.stderr.write(`env ${seen.join(" ")}\n`);
	process.exit(1);
}
// "hang": never reads/responds. The client's initTimeoutMs is what ends this.
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
let onCancel = null;
const cancelled = () =>
	new Promise((resolve) => {
		onCancel = resolve;
	});
async function turn(sessionId, promptText) {
	turns += 1;
	if (mode === "crash") process.exit(3);
	if (mode === "resume") {
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: `Heard: ${promptText}` },
		});
		return { stopReason: "end_turn" };
	}
	if (mode === "silent") {
		await cancelled();
		return { stopReason: "cancelled" };
	}
	if (mode === "tolerant") {
		notify(sessionId, {
			sessionUpdate: "unknown_session_update_kind",
			extraField: "extra_update_val",
		});
		notify(sessionId, {
			sessionUpdate: "unknown_session_update_kind",
			extraField: "extra_update_val_again",
		});
		notify(sessionId, {
			sessionUpdate: "tool_call",
			toolCallId: "t_custom",
			title: "custom tool",
			kind: "unknown_tool_kind",
			status: "pending",
			extraField: "extra_tool_val",
			rawInput: { command: "custom" },
		});
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Turn done." },
			extraField: "extra_chunk_val",
		});
		return { stopReason: "unknown_stop_reason", extraField: "extra_stop_val" };
	}
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
		if (mode === "steerable" && process.env.FAKE_WAIT_CANCEL) {
			await cancelled();
			return { stopReason: "cancelled" };
		}
	}
	if (mode === "steerable" && turns > 1)
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: `Heard: ${promptText}\n` },
		});
	const valid =
		mode === "ok" ||
		mode === "nowrite" ||
		mode === "steerable" ||
		(mode === "retry" && turns >= 2);
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
	if (mode === "hang") return; // never answer; the client's own timeout ends the probe
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
		// "slow-init": answer initialize after FAKE_INIT_DELAY_MS, then never answer session/new.
		if (mode === "slow-init")
			await new Promise((r) =>
				setTimeout(r, Number(process.env.FAKE_INIT_DELAY_MS)),
			);
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: 1,
				agentInfo: { name: "fake", version: "0" },
				...(process.env.FAKE_LOAD_SESSION
					? { agentCapabilities: { loadSession: true } }
					: {}),
				...(mode === "auth-required"
					? { authMethods: [{ id: "login", name: "Log in with Fake" }] }
					: {}),
			},
		});
	} else if (msg.method === "session/new" && mode === "auth-required") {
		send({
			jsonrpc: "2.0",
			id: msg.id,
			error: { code: -32000, message: "Authentication required" },
		});
	} else if (msg.method === "session/new" && mode === "slow-init") {
		// never answered
	} else if (msg.method === "session/new") {
		if (msg.params?.cwd !== cwd)
			process.stderr.write(`fake: session cwd ${msg.params?.cwd} != ${cwd}\n`);
		// FAKE_SERVED_MODEL: report that model as selected, the way a real harness does.
		const served = process.env.FAKE_SERVED_MODEL;
		const configOptions = served
			? [
					{
						id: "model",
						type: "select",
						category: "model",
						currentValue: served,
						options: [{ value: served, name: served }],
					},
				]
			: undefined;
		// FAKE_MODES: the session modes it advertises, comma-separated, the first current.
		const modeIds = (process.env.FAKE_MODES ?? "").split(",").filter(Boolean);
		const modes = modeIds.length
			? {
					currentModeId: modeIds[0],
					availableModes: modeIds.map((id) => ({ id, name: id })),
				}
			: undefined;
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				sessionId: "s1",
				...(configOptions ? { configOptions } : {}),
				...(modes ? { modes } : {}),
			},
		});
	} else if (msg.method === "session/load") {
		const sessionId = msg.params?.sessionId;
		notify(sessionId, {
			sessionUpdate: "user_message_chunk",
			content: { type: "text", text: "the first prompt" },
		});
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "REPLAYED" },
		});
		send({ jsonrpc: "2.0", id: msg.id, result: {} });
	} else if (msg.method === "session/prompt") {
		const text = msg.params?.prompt?.[0]?.text ?? "";
		const result = await turn(msg.params.sessionId, text);
		send({ jsonrpc: "2.0", id: msg.id, result });
	} else if (msg.method === "session/cancel") {
		process.stderr.write("fake: cancel\n");
		onCancel?.();
		onCancel = null;
	} else if (msg.id !== undefined) {
		send({ jsonrpc: "2.0", id: msg.id, result: {} });
	}
});
