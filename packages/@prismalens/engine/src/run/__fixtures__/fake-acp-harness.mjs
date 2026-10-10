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
// "continue" (like "resume", but every turn also writes a valid report: a stopped run taken on, R4.4),
// or "auth-required" (offers authMethods, then answers session/new with ACP's -32000).
// FAKE_MODELS / FAKE_EFFORTS offer model and thought_level options that session/set_config_option
// switches (FAKE_REFUSE_SET keeps the old value; FAKE_REJECT_SET answers with an RPC error instead);
// FAKE_MODES offers modes for session/new and session/load (first is currentModeId);
// FAKE_IMAGES=1 advertises promptCapabilities.image. It always attempts one read-only shell call and one write,
// and reports what the client decided for each so the test can assert the gate.
// Access levels (#673 w21): FAKE_PROFILE=claude offers default, acceptEdits, auto, bypassPermissions
// and plan over session/set_mode when FAKE_MODES is unset; FAKE_PROFILE=codex offers its modes as a
// `mode` config option (read-only, agent, agent-full-access; FAKE_CODEX_V2=1 adds workspace-write).
// FAKE_ACP_MODE=switch-mode first asks to enter its own plan mode with a `switch_mode` ask, then runs
// as "ok". argv flags: --clamp-auto answers a switch to `auto` with
// `acceptEdits` as current; --refuse-mode answers every mode switch with an RPC error.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_ACP_MODE ?? "ok";
const cwd = process.cwd();
const clampAuto =
	process.argv.includes("--clamp-auto") || Boolean(process.env.FAKE_CLAMP_AUTO);
const refuseModeArg =
	process.argv.find(
		(a) => a === "--refuse-mode" || a.startsWith("--refuse-mode="),
	) ?? "";
const refuseModeTarget = refuseModeArg.startsWith("--refuse-mode=")
	? refuseModeArg.slice(14)
	: (process.env.FAKE_REFUSE_MODES ?? "");
const refuseMode =
	process.argv.includes("--refuse-mode") ||
	Boolean(refuseModeTarget) ||
	Boolean(process.env.FAKE_REFUSE_MODE);
const profile = process.env.FAKE_PROFILE ?? "";

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
// What session/set_config_option can switch, and the value each option holds now.
const offered = {
	model: (process.env.FAKE_MODELS ?? process.env.FAKE_SERVED_MODEL ?? "")
		.split(",")
		.filter(Boolean),
	reasoning_effort: (process.env.FAKE_EFFORTS ?? "").split(",").filter(Boolean),
};
const current = {
	model: process.env.FAKE_SERVED_MODEL ?? offered.model[0],
	reasoning_effort: offered.reasoning_effort[0],
};
// The session's modes: FAKE_MODES (`id` or `id=Name`, first current), else the profile's.
const CLAUDE_MODES =
	"default=Manual,acceptEdits=Accept Edits,auto=Auto,bypassPermissions=Bypass Permissions,plan=Plan";
const CODEX_MODES = `read-only=Ask for approval,${process.env.FAKE_CODEX_V2 ? "workspace-write=Workspace write," : ""}agent=Approve for me,agent-full-access=Full access`;
const modeList = (
	(process.env.FAKE_MODES ? process.env.FAKE_MODES : null) ??
	(profile === "claude" ? CLAUDE_MODES : profile === "codex" ? CODEX_MODES : "")
)
	.split(",")
	.filter(Boolean)
	.map((m) => {
		const [id, name] = m.split("=");
		return { id, name: name ?? id };
	});
let currentMode = modeList[0]?.id;
const modeOptions = () =>
	profile === "codex"
		? [
				{
					id: "mode",
					name: "Mode",
					type: "select",
					category: "mode",
					currentValue: currentMode,
					options: modeList.map((m) => ({ value: m.id, name: m.name })),
				},
			]
		: [];
const sessionModes = () =>
	profile !== "codex" && modeList.length
		? { currentModeId: currentMode, availableModes: modeList }
		: undefined;
/** A mode switch as the agent takes it: refused, clamped, or as asked. */
const switchMode = (sessionId, modeId) => {
	if (
		refuseMode &&
		(!refuseModeTarget || refuseModeTarget.split(",").includes(modeId))
	)
		return false;
	currentMode = clampAuto && modeId === "auto" ? "acceptEdits" : modeId;
	if (profile !== "codex")
		notify(sessionId, {
			sessionUpdate: "current_mode_update",
			currentModeId: currentMode,
		});
	return true;
};
const configOptions = () => [
	...modeOptions(),
	...(offered.model.length
		? [
				{
					id: "model",
					type: "select",
					category: "model",
					currentValue: current.model,
					options: offered.model.map((v) => ({ value: v, name: v })),
				},
			]
		: []),
	...(offered.reasoning_effort.length
		? [
				{
					id: "reasoning_effort",
					type: "select",
					category: "thought_level",
					currentValue: current.reasoning_effort,
					options: offered.reasoning_effort.map((v) => ({ value: v, name: v })),
				},
			]
		: []),
];
let onCancel = null;
// A cancel can land before the turn awaits it (#809); it is latched until the turn ends.
let cancelLatched = false;
const cancelled = () =>
	cancelLatched
		? Promise.resolve()
		: new Promise((resolve) => {
				onCancel = resolve;
			});
async function turn(sessionId, promptText) {
	turns += 1;
	cancelLatched = false;
	if (mode === "crash") process.exit(3);
	if (mode === "resume" || mode === "continue") {
		// FAKE_RESUME_CURL: the reopened session queries a host address first (#673 w26).
		if (process.env.FAKE_RESUME_CURL) {
			const command = "curl -s http://localhost:9090/api/v1/query?query=up";
			const toolCall = {
				toolCallId: "t_curl",
				title: command,
				kind: "execute",
				rawInput: { command },
			};
			notify(sessionId, {
				sessionUpdate: "tool_call",
				status: "pending",
				...toolCall,
			});
			const c = await ask({
				sessionId,
				toolCall,
				options: [
					{ optionId: "once", kind: "allow_once" },
					{ optionId: "reject", kind: "reject_once" },
				],
			});
			const ok = c.outcome?.optionId === "once";
			notify(sessionId, {
				sessionUpdate: "tool_call_update",
				toolCallId: "t_curl",
				status: ok ? "completed" : "failed",
				content: [
					{
						type: "content",
						content: { type: "text", text: ok ? "up 1" : "denied" },
					},
				],
			});
		}
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `Heard: ${promptText}${mode === "continue" ? `\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n` : ""}`,
			},
		});
		return { stopReason: "end_turn" };
	}
	if (mode === "silent") {
		await cancelled();
		return { stopReason: "cancelled" };
	}
	if (mode === "switch-mode" && turns === 1) {
		const answer = await ask({
			sessionId,
			toolCall: {
				toolCallId: "t_switch",
				title: "Enter Plan Mode",
				kind: "switch_mode",
				rawInput: {},
			},
			options: [
				{ optionId: "yes", name: "Yes, enter plan mode", kind: "allow_once" },
				{ optionId: "no", name: "No", kind: "reject_once" },
			],
		});
		const left = answer.outcome?.optionId === "yes";
		process.stderr.write(`fake: mode ${left ? "SWITCHED" : "kept"}\n`);
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
	// FAKE_RETRY_WAIT_CANCEL: the report retry turn waits for session/cancel (a Stop mid-retry).
	if (
		process.env.FAKE_RETRY_WAIT_CANCEL &&
		promptText.startsWith("Your final message did not")
	) {
		await cancelled();
		return { stopReason: "cancelled" };
	}
	// FAKE_REPORT_THEN_WAIT_CANCEL: a valid report is already in the turn when Stop lands,
	// and the agent still ends the turn as end_turn (#673 w59).
	// The value is a file written once the report is sent, so the test stops after it.
	if (process.env.FAKE_REPORT_THEN_WAIT_CANCEL) {
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `Done.\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`,
			},
		});
		writeFileSync(process.env.FAKE_REPORT_THEN_WAIT_CANCEL, "sent");
		await cancelled();
		return { stopReason: "end_turn" };
	}
	if (mode === "steerable" && turns > 1)
		notify(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: `Heard: ${promptText}\n` },
		});
	const valid =
		mode === "ok" ||
		mode === "switch-mode" ||
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
		// FAKE_INIT_DELAY_MS delays initialize in any mode; "slow-init" then never answers session/new.
		if (process.env.FAKE_INIT_DELAY_MS)
			await new Promise((r) =>
				setTimeout(r, Number(process.env.FAKE_INIT_DELAY_MS)),
			);
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: 1,
				agentInfo: { name: "fake", version: "0" },
				agentCapabilities: {
					...(process.env.FAKE_LOAD_SESSION ? { loadSession: true } : {}),
					...(process.env.FAKE_IMAGES
						? { promptCapabilities: { image: true } }
						: {}),
				},
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
		const options = configOptions();
		const modes = sessionModes();
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				sessionId: "s1",
				...(options.length ? { configOptions: options } : {}),
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
		const options = configOptions();
		const modes = sessionModes();
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				...(options.length ? { configOptions: options } : {}),
				...(modes ? { modes } : {}),
			},
		});
	} else if (msg.method === "session/set_config_option") {
		const { configId, value } = msg.params ?? {};
		// FAKE_REJECT_SET: the agent answers with an RPC error instead of a silent non-switch.
		if (process.env.FAKE_REJECT_SET) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32602, message: `rejected: ${configId}=${value}` },
			});
			return;
		}
		if (profile === "codex" && configId === "mode") {
			if (
				!modeList.some((m) => m.id === value) ||
				!switchMode(msg.params.sessionId, value)
			) {
				send({
					jsonrpc: "2.0",
					id: msg.id,
					error: { code: -32602, message: `mode ${value} refused` },
				});
				return;
			}
		} else if (
			!process.env.FAKE_REFUSE_SET &&
			offered[configId]?.includes(value)
		)
			current[configId] = value;
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: { configOptions: configOptions() },
		});
	} else if (msg.method === "session/set_mode") {
		const { sessionId, modeId } = msg.params ?? {};
		if (!switchMode(sessionId, modeId)) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32603, message: `mode ${modeId} refused` },
			});
			return;
		}
		process.stderr.write(`fake: mode ${currentMode}\n`);
		send({ jsonrpc: "2.0", id: msg.id, result: {} });
	} else if (msg.method === "session/prompt") {
		const blocks = msg.params?.prompt ?? [];
		for (const b of blocks)
			if (b.type === "image")
				process.stderr.write(`fake: image ${b.mimeType}\n`);
		const text = blocks[0]?.text ?? "";
		const result = await turn(msg.params.sessionId, text);
		send({ jsonrpc: "2.0", id: msg.id, result });
	} else if (msg.method === "session/cancel") {
		process.stderr.write("fake: cancel\n");
		cancelLatched = true;
		onCancel?.();
		onCancel = null;
	} else if (msg.id !== undefined) {
		send({ jsonrpc: "2.0", id: msg.id, result: {} });
	}
});
