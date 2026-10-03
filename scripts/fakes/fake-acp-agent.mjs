#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Speaks ACP v1 on stdio and replays a scripted session (scripts/fakes/sessions/*.json).
// The harness env is allowlisted, so the script is picked by --session or by
// `fake-session:<name>` in the first prompt; a file under TMPDIR carries it to session/load.
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SESSIONS_DIR = join(HERE, "sessions");
export const FAKE_AGENT_PATH = fileURLToPath(import.meta.url);

const PICKED_DIR = join(tmpdir(), "prismalens-fake-acp-agent");

/**
 * @param {string} nameOrPath
 * @returns {import("./fake-acp-agent.d.mts").FakeSession}
 */
export function loadSession(nameOrPath) {
	const file =
		isAbsolute(nameOrPath) || nameOrPath.endsWith(".json")
			? resolve(nameOrPath)
			: join(SESSIONS_DIR, `${nameOrPath}.json`);
	if (!existsSync(file)) throw new Error(`fake-acp-agent: no session ${file}`);
	return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Puts the fake on PATH under the harness binaries the registry looks for.
 * @param {string} binDir
 * @param {{ session?: string, binaries?: string[] }} [opts]
 */
export function installFakeAgent(binDir, opts = {}) {
	const session = opts.session ?? "success";
	const binaries = opts.binaries ?? ["opencode", "claude-agent-acp"];
	for (const bin of binaries) {
		const target = join(binDir, bin);
		writeFileSync(
			target,
			`#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGENT_PATH}" --session ${session} "$@"\n`,
		);
		chmodSync(target, 0o755);
		writeFileSync(
			`${target}.cmd`,
			`@echo off\r\n"${process.execPath}" "${FAKE_AGENT_PATH}" --session ${session} %*\r\n`,
		);
	}
	return binaries.map((b) => join(binDir, b));
}

function run() {
	const sessionArg = process.argv.indexOf("--session");
	const defaultName =
		sessionArg > -1 ? process.argv[sessionArg + 1] : "success";
	const cwd = process.cwd();
	let script = loadSession(defaultName);
	let scriptName = defaultName;
	let turns = 0;
	let sessionId = "";
	let nextId = 1000;
	/** @type {Map<number, (result: { outcome?: { outcome?: string, optionId?: string } }) => void>} */
	const pending = new Map();
	/** @type {(() => void) | null} */
	let onCancel = null;

	const send = (/** @type {unknown} */ message) =>
		process.stdout.write(`${JSON.stringify(message)}\n`);
	const notify = (
		/** @type {string} */ sessionId,
		/** @type {unknown} */ update,
	) =>
		send({
			jsonrpc: "2.0",
			method: "session/update",
			params: { sessionId, update },
		});
	const sleep = (/** @type {number} */ ms) =>
		new Promise((r) => setTimeout(r, ms));
	const fill = (/** @type {string} */ text, /** @type {string} */ prompt) =>
		text.replaceAll("{{cwd}}", cwd).replaceAll("{{prompt}}", prompt);
	const text = (/** @type {string} */ t) => ({ type: "text", text: t });

	/** @param {Record<string, unknown>} params */
	function askPermission(params) {
		return new Promise((resolvePermission) => {
			const id = nextId++;
			pending.set(id, resolvePermission);
			send({
				jsonrpc: "2.0",
				id,
				method: "session/request_permission",
				params,
			});
		});
	}

	/**
	 * @param {string} sessionId
	 * @param {import("./fake-acp-agent.d.mts").Step[]} steps
	 * @param {string} prompt
	 * @returns {Promise<string | null>} a stopReason a step forced, or null
	 */
	async function play(sessionId, steps, prompt) {
		for (const step of steps) {
			if (step.delayMs) await sleep(step.delayMs);
			if (step.say !== undefined) {
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(fill(step.say, prompt)),
				});
			}
			if (step.think !== undefined) {
				notify(sessionId, {
					sessionUpdate: "agent_thought_chunk",
					content: text(fill(step.think, prompt)),
				});
			}
			if (step.update) notify(sessionId, step.update);
			if (step.tool) await tool(sessionId, step.tool);
			if (step.report) {
				const body = JSON.stringify(step.report, null, 2);
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(`\n\`\`\`json\n${fill(body, prompt)}\n\`\`\`\n`),
				});
			}
			if (step.stderr) process.stderr.write(`${step.stderr}\n`);
			if (step.exit !== undefined) process.exit(step.exit);
			if (step.waitForCancel) {
				await new Promise((r) => {
					onCancel = () => r(undefined);
				});
				return "cancelled";
			}
			if (step.stop) return step.stop;
		}
		return null;
	}

	/**
	 * Claude Code's shape: the call opens as "Terminal" with empty input, and the
	 * command arrives in a progress update before the permission request.
	 * @param {string} sessionId
	 * @param {import("./fake-acp-agent.d.mts").ToolStep} t
	 */
	async function tool(sessionId, t) {
		const kind = t.kind ?? "execute";
		notify(sessionId, {
			sessionUpdate: "tool_call",
			toolCallId: t.id,
			title: "Terminal",
			kind,
			status: "pending",
			rawInput: {},
		});
		notify(sessionId, {
			sessionUpdate: "tool_call_update",
			toolCallId: t.id,
			status: "in_progress",
			title: t.title,
			rawInput: t.rawInput,
		});
		let allowed = true;
		if (t.ask !== false) {
			const answer = await askPermission({
				sessionId,
				toolCall: {
					toolCallId: t.id,
					title: t.title,
					kind,
					rawInput: t.rawInput,
				},
				options: [
					{ optionId: "allow", name: "Allow", kind: "allow_once" },
					{
						optionId: "allow_always",
						name: "Always allow",
						kind: "allow_always",
					},
					{ optionId: "reject", name: "Reject", kind: "reject_once" },
				],
			});
			allowed =
				answer.outcome?.outcome === "selected" &&
				answer.outcome.optionId?.startsWith("allow") === true;
		}
		notify(sessionId, {
			sessionUpdate: "tool_call_update",
			toolCallId: t.id,
			status: allowed ? "completed" : "failed",
			content: [
				{
					type: "content",
					content: text(
						allowed
							? (t.output ?? "")
							: "The user rejected permission to use this specific tool call.",
					),
				},
			],
		});
	}

	/** @param {string} sessionId @param {string} prompt */
	async function turn(sessionId, prompt) {
		turns += 1;
		const scripted = script.turns ?? [];
		const steps =
			turns <= scripted.length
				? scripted[turns - 1]
				: (script.followUp ?? [{ say: "Heard: {{prompt}}" }]);
		const forced = await play(sessionId, steps, prompt);
		return { stopReason: forced ?? "end_turn" };
	}

	createInterface({ input: process.stdin }).on("line", async (line) => {
		/** @type {{ id?: number, method?: string, params?: Record<string, unknown>, result?: unknown }} */
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.id !== undefined && !msg.method && pending.has(msg.id)) {
			pending.get(msg.id)?.(msg.result ?? {});
			pending.delete(msg.id);
			return;
		}
		const reply = (/** @type {unknown} */ result) =>
			send({ jsonrpc: "2.0", id: msg.id, result });
		switch (msg.method) {
			case "initialize":
				return reply({
					protocolVersion: 1,
					agentInfo: script.agent ?? { name: "fake-acp-agent", version: "0" },
					agentCapabilities: { loadSession: script.loadSession !== false },
					authMethods: [],
				});
			case "session/new":
				sessionId = `fake-${Date.now().toString(36)}-${process.pid}`;
				return reply({
					sessionId,
					...(script.configOptions
						? { configOptions: script.configOptions }
						: {}),
				});
			case "session/load": {
				sessionId = String(msg.params?.sessionId ?? "");
				const pickedFile = join(PICKED_DIR, sessionId);
				const named = existsSync(pickedFile)
					? readFileSync(pickedFile, "utf8")
					: null;
				if (named && named !== scriptName) {
					script = loadSession(named);
					scriptName = named;
				}
				// A reopened session is past its scripted turns: every prompt is a follow-up.
				turns = (script.turns ?? []).length;
				await play(sessionId, script.load ?? [], "");
				return reply({});
			}
			case "session/prompt": {
				const prompt = (msg.params?.prompt ?? [])
					.map((/** @type {{ text?: string }} */ b) => b.text ?? "")
					.join("");
				if (turns === 0) {
					const picked = prompt.match(/fake-session:([a-z0-9-]+)/)?.[1];
					if (picked && picked !== scriptName) {
						script = loadSession(picked);
						scriptName = picked;
					}
					mkdirSync(PICKED_DIR, { recursive: true });
					writeFileSync(join(PICKED_DIR, sessionId), scriptName);
				}
				return reply(await turn(sessionId, prompt));
			}
			case "session/cancel":
				onCancel?.();
				onCancel = null;
				return;
			default:
				if (msg.id !== undefined) reply({});
		}
	});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run();
