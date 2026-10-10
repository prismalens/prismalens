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
	readdirSync,
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

// Per install, so concurrent e2e stacks never see each other's releases (--state-dir).
const DEFAULT_STATE_DIR = join(tmpdir(), "prismalens-fake-acp-agent");
const stateArg = process.argv.indexOf("--state-dir");
const PICKED_DIR =
	stateArg > -1 ? process.argv[stateArg + 1] : DEFAULT_STATE_DIR;

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

const RELEASE_DIR = join(PICKED_DIR, "release");

/** Claude Code's modes and OpenCode's agents, so each permission level and Plan has its mode (#673 w21). */
const DEFAULT_MODES = {
	currentModeId: "default",
	availableModes: [
		{ id: "default", name: "Manual" },
		{ id: "acceptEdits", name: "Accept Edits" },
		{ id: "auto", name: "Auto" },
		{ id: "bypassPermissions", name: "Bypass Permissions" },
		{ id: "build", name: "Build" },
		{ id: "plan", name: "Plan" },
	],
};

/** The release directory of the fakes installed with `stateDir`. */
export function releaseDir(stateDir = DEFAULT_STATE_DIR) {
	return join(stateDir, "release");
}

/** Lets a run held by `waitForRelease` go on: any prompt containing `key` continues. */
export function releaseRun(key, stateDir = DEFAULT_STATE_DIR) {
	mkdirSync(releaseDir(stateDir), { recursive: true });
	writeFileSync(join(releaseDir(stateDir), encodeURIComponent(key)), "");
}

/** @param {string} prompt */
function releasedFor(prompt) {
	if (!existsSync(RELEASE_DIR)) return false;
	return readdirSync(RELEASE_DIR).some((f) =>
		prompt.includes(decodeURIComponent(f)),
	);
}

/**
 * Puts the fake on PATH under the harness binaries the registry looks for.
 * @param {string} binDir
 * @param {{ session?: string, binaries?: string[], stateDir?: string }} [opts]
 */
export function installFakeAgent(binDir, opts = {}) {
	const session = opts.session ?? "success";
	const binaries = opts.binaries ?? ["opencode", "claude-agent-acp"];
	const args = `--session "${session}"${opts.stateDir ? ` --state-dir "${opts.stateDir}"` : ""}`;
	for (const bin of binaries) {
		const target = join(binDir, bin);
		writeFileSync(
			target,
			`#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGENT_PATH}" ${args} "$@"\n`,
		);
		chmodSync(target, 0o755);
		writeFileSync(
			`${target}.cmd`,
			`@echo off\r\n"${process.execPath}" "${FAKE_AGENT_PATH}" ${args} %*\r\n`,
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
	let loaded = false;
	let sessionId = "";
	let nextId = 1000;
	/** @type {Map<number, (result: { outcome?: { outcome?: string, optionId?: string } }) => void>} */
	const pending = new Map();
	/** @type {(() => void) | null} */
	let onCancel = null;
	/** @type {string | null} */
	let currentMode = null;
	/** The script's modes, or the default set, with the mode a switch took as current. */
	const sessionModes = () => {
		const modes = script.modes ?? DEFAULT_MODES;
		return { ...modes, currentModeId: currentMode ?? modes.currentModeId };
	};

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
		text
			.replaceAll("{{cwd}}", cwd)
			.replaceAll("{{prompt}}", prompt)
			.replaceAll(
				"{{attached}}",
				Array.from(
					prompt.matchAll(/A file the operator attached: ([^\s]+)\./g),
					(m) => m[1],
				).join(", ") || "nothing",
			);
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
			// Holds the turn until a test drops a file named for this prompt (releaseRun).
			if (step.waitForRelease) {
				const released =
					releasedFor(prompt) ||
					(await new Promise((r) => {
						const poll = setInterval(() => {
							if (releasedFor(prompt)) {
								clearInterval(poll);
								r(true);
							}
						}, 200);
						onCancel = () => {
							clearInterval(poll);
							r(false);
						};
					}));
				if (!released) return "cancelled";
			}
			if (step.stop) return step.stop;
		}
		return null;
	}

	/**
	 * Claude Code's shape: the call opens as "Terminal" with empty input, and the
	 * command arrives in a progress update before the permission request.
	 * @param {string} sessionId
	 * @param {import("./fake-acp-agent.d.mts").ToolStep} step
	 */
	async function tool(sessionId, step) {
		// `{{cwd}}` in a call is the run's own copy, as a harness would print it.
		const t = JSON.parse(
			JSON.stringify(step).replaceAll(
				"{{cwd}}",
				JSON.stringify(cwd).slice(1, -1),
			),
		);
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
		let allowed = t.fail === undefined;
		// Reads run unasked, as a supervised mode runs them; `ask: true` is a call the agent asks about (#673 w21).
		if (allowed && t.ask === true) {
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
							: (t.fail ??
									"The user rejected permission to use this specific tool call."),
					),
				},
			],
		});
	}

	/** @param {string} sessionId @param {string} prompt */
	async function turn(sessionId, prompt) {
		turns += 1;
		const scripted = script.turns ?? [];
		// The host's "your report did not validate" retry gets the script's own answer.
		const retry =
			prompt.startsWith("Your final message did not") && script.retry;
		// `steer` answers a message to the run still in this process; `followUp` one after session/load.
		const steps = retry
			? script.retry
			: turns <= scripted.length
				? scripted[turns - 1]
				: !loaded && script.steer
					? script.steer
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
					agentCapabilities: {
						loadSession: script.loadSession !== false,
						promptCapabilities: { image: script.images === true },
					},
					authMethods: [],
				});
			case "session/new":
				sessionId = `fake-${Date.now().toString(36)}-${process.pid}`;
				return reply({
					sessionId,
					modes: sessionModes(),
					...(script.configOptions
						? { configOptions: script.configOptions }
						: {}),
				});
			case "session/set_mode": {
				// Takes a mode it lists and says so, as an agent reports its own mode (ACP session-modes).
				const modeId = String(msg.params?.modeId ?? "");
				if (!sessionModes().availableModes.some((m) => m.id === modeId)) {
					send({
						jsonrpc: "2.0",
						id: msg.id,
						error: { code: -32602, message: `no mode ${modeId}` },
					});
					return;
				}
				currentMode = modeId;
				notify(sessionId, {
					sessionUpdate: "current_mode_update",
					currentModeId: modeId,
				});
				return reply({});
			}
			case "session/set_config_option": {
				// Takes a value its option lists, unless the script refuses switches.
				const { configId, value } = msg.params ?? {};
				for (const option of script.configOptions ?? []) {
					const values = (option.options ?? []).flatMap((o) =>
						o.options ? o.options : [o],
					);
					if (
						option.id === configId &&
						!script.refuseConfig &&
						values.some((o) => o.value === value)
					)
						option.currentValue = value;
				}
				return reply({ configOptions: script.configOptions ?? [] });
			}
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
				loaded = true;
				await play(sessionId, script.load ?? [], "");
				return reply({ modes: sessionModes() });
			}
			case "session/prompt": {
				const blocks = msg.params?.prompt ?? [];
				const images = blocks.filter(
					(/** @type {{ type?: string }} */ b) => b.type === "image",
				).length;
				const prompt =
					blocks
						.map((/** @type {{ text?: string }} */ b) => b.text ?? "")
						.join("") + (images ? `\n[${images} image(s) attached]` : "");
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
