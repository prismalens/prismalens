#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
// Speaks ACP v1 on stdio and replays a scripted session (scripts/fakes/sessions/*.json).
// The harness env is allowlisted, so the script is picked by --session or by
// `fake-session:<name>` in the first prompt; a file under TMPDIR carries it to session/load.
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
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
const CAPS_DIR = join(PICKED_DIR, "caps");

/** Each agent's own modes, by the binary the fake was installed as, so a picker lists one agent's (#1101). */
const AGENT_MODES = {
	"claude-agent-acp": {
		currentModeId: "default",
		availableModes: [
			{ id: "default", name: "Manual" },
			{ id: "acceptEdits", name: "Accept Edits" },
			{ id: "auto", name: "Auto" },
			{ id: "bypassPermissions", name: "Bypass Permissions" },
			{ id: "plan", name: "Plan" },
		],
	},
	opencode: {
		currentModeId: "build",
		availableModes: [
			{ id: "build", name: "Build" },
			{ id: "plan", name: "Plan" },
		],
	},
};
const asArg = process.argv.indexOf("--as");
const DEFAULT_MODES =
	AGENT_MODES[asArg > -1 ? process.argv[asArg + 1] : "claude-agent-acp"] ??
	AGENT_MODES["claude-agent-acp"];

/**
 * Turn an `initialize` capability on or off for the fakes installed with `stateDir` (#1024):
 * a session is picked at the first prompt, after `initialize`, so a capability cannot be.
 * @param {"additionalDirectories"} name
 * @param {boolean} on
 */
export function setFakeCapability(name, on, stateDir = DEFAULT_STATE_DIR) {
	const file = join(stateDir, "caps", name);
	if (on) {
		mkdirSync(join(stateDir, "caps"), { recursive: true });
		writeFileSync(file, "");
	} else rmSync(file, { force: true });
}

/**
 * The ACP protocol version the fakes installed with `stateDir` answer `initialize` with,
 * or null for v1; protocol.drift answers one the host does not know (#1101).
 * @param {number | null} version
 */
export function setFakeProtocolVersion(version, stateDir = DEFAULT_STATE_DIR) {
	const file = join(stateDir, "caps", "protocolVersion");
	if (version === null) rmSync(file, { force: true });
	else {
		mkdirSync(join(stateDir, "caps"), { recursive: true });
		writeFileSync(file, String(version));
	}
}

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
 * @param {{ session?: string, binaries?: string[], stateDir?: string, mcp?: boolean }} [opts]
 */
export function installFakeAgent(binDir, opts = {}) {
	const session = opts.session ?? "success";
	const binaries = opts.binaries ?? ["opencode", "claude-agent-acp"];
	const args = `--session "${session}"${opts.stateDir ? ` --state-dir "${opts.stateDir}"` : ""}${opts.mcp ? " --mcp" : ""}`;
	for (const bin of binaries) {
		const target = join(binDir, bin);
		const own = `${args} --as "${bin}"`;
		writeFileSync(
			target,
			`#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGENT_PATH}" ${own} "$@"\n`,
		);
		chmodSync(target, 0o755);
		writeFileSync(
			`${target}.cmd`,
			`@echo off\r\n"${process.execPath}" "${FAKE_AGENT_PATH}" ${own} %*\r\n`,
		);
	}
	return binaries.map((b) => join(binDir, b));
}

function run() {
	const sessionArg = process.argv.indexOf("--session");
	const defaultName =
		process.env.FAKE_ACP_MODE === "switch-mode"
			? "switch-mode"
			: sessionArg > -1
				? process.argv[sessionArg + 1]
				: "success";
	const cwd = process.cwd();
	let script = loadSession(defaultName);
	let scriptName = defaultName;
	let turns = 0;
	let loaded = false;
	/** @type {Record<string, unknown>} */
	let respond = {};
	let sessionId = "";
	/** The session `session/new` or `session/load` opened; anything else is a sub-agent's. */
	let rootSessionId = "";
	let nextId = 1000;
	/** @type {Map<number, (result: { outcome?: { outcome?: string, optionId?: string } }) => void>} */
	const pending = new Map();
	/** @type {(() => void) | null} */
	let onCancel = null;
	/** A sub-agent session's own cancel, by its session id (#1025). @type {Map<string, () => void>} */
	const childCancels = new Map();
	/** The client declared `clientCapabilities.subagents` at initialize (#1025). */
	let clientSubagents = false;
	/** @type {string | null} */
	let currentMode = null;
	/** The client declared form elicitation at initialize (#1024). */
	let clientElicits = false;
	/** @type {{ type?: string, uri?: string, name?: string }[]} The prompt's resource links. */
	let links = [];
	// `--mcp` takes HTTP MCP servers, so a run offers it PrismaLens's gateway (#1024).
	const mcp = process.argv.includes("--mcp");
	/** @type {{ url: string, headers: Record<string, string> } | null} */
	let gateway = null;
	/** @type {string | undefined} */
	let mcpSession;
	let rpcId = 1;
	/** The text of the last `call` step's result, for `{{result}}`. */
	let lastResult = "";
	/** A cancel arrived during this turn; only `repeat` stops on it. */
	let cancelRequested = false;

	/** @param {string} method @param {Record<string, unknown>} params */
	async function mcpRequest(method, params) {
		if (!gateway) throw new Error("fake-acp-agent: no gateway was offered");
		const res = await fetch(gateway.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...gateway.headers,
				...(mcpSession ? { "mcp-session-id": mcpSession } : {}),
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
		});
		mcpSession = res.headers.get("mcp-session-id") ?? mcpSession;
		const body = await res.text();
		// A streamable-HTTP server may answer as one SSE event instead of plain JSON.
		const json = body.startsWith("event:")
			? (
					body.split(/\r?\n/).find((l) => l.startsWith("data:")) ?? "data:{}"
				).slice(5)
			: body;
		return /** @type {{ result?: { content?: { text?: string }[] }, error?: { message: string } }} */ (
			JSON.parse(json || "{}")
		);
	}

	/** Connects as an agent does when its session opens; the engine counts it as taken. */
	async function connect(/** @type {unknown} */ servers) {
		const http = Array.isArray(servers)
			? servers.find((s) => s?.type === "http")
			: undefined;
		if (!mcp || !http) return;
		gateway = {
			url: http.url,
			headers: Object.fromEntries(
				(http.headers ?? []).map((h) => [h.name, h.value]),
			),
		};
		await mcpRequest("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "fake-acp-agent", version: "0" },
		}).catch(() => {});
	}
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
			// An agent that prints a variable it was given, as a careless one would (#1024 spec B).
			.replace(
				/\{\{env:([A-Z0-9_]+)\}\}/g,
				(_, name) => process.env[name] ?? "",
			)
			.replaceAll("{{cwd}}", cwd)
			.replaceAll(
				"{{delay-ms}}",
				[...prompt.matchAll(/delay-ms:(\d+)/g)].at(-1)?.[1] ?? "0",
			)
			.replaceAll("{{prompt}}", prompt)
			// The first web address in the prompt, for a session that opens a test's page (#1061).
			.replaceAll(
				"{{url}}",
				prompt.match(/https?:\/\/[^\s"']*[^\s"'.,;)]/)?.[0] ?? "",
			)
			.replaceAll("{{result}}", lastResult)
			// The link of the thread whose message this prompt carries; `starter` when none did.
			.replaceAll(
				"{{from}}",
				[
					...prompt.matchAll(
						/\[Message from [^\]]*\((\/threads\/[0-9a-f-]{36})\)\]/g,
					),
				].at(-1)?.[1] ?? "starter",
			)
			// A fresh key per turn, so a reopened session's sends are never taken for retries.
			.replaceAll("{{seq}}", `${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
			.replaceAll(
				"{{send-to}}",
				[...prompt.matchAll(/send-to:([a-z0-9-]+)/g)].at(-1)?.[1] ?? "parent",
			)
			.replaceAll(
				"{{attached}}",
				Array.from(
					prompt.matchAll(/A file the operator attached: ([^\s]+)\./g),
					(m) => m[1],
				).join(", ") || "nothing",
			);
	const text = (/** @type {string} */ t) => ({ type: "text", text: t });

	/** `elicitation/create`: a form question or input, answered by the host (#1024). */
	function elicit(/** @type {Record<string, unknown>} */ params) {
		return new Promise((resolveElicit) => {
			const id = nextId++;
			pending.set(id, resolveElicit);
			send({ jsonrpc: "2.0", id, method: "elicitation/create", params });
		});
	}

	/** Each linked file's bytes, read the way the agent would: a file:// path it may read, else the link itself. */
	function readLinks() {
		return links.map((l) => {
			const uri = String(l.uri ?? "");
			if (!uri.startsWith("file://")) return `Link ${l.name}: ${uri}`;
			try {
				return `Read ${l.name}: ${readFileSync(fileURLToPath(uri), "utf8").slice(0, 4000)}`;
			} catch (e) {
				return `Could not read ${l.name}: ${e instanceof Error ? e.message : String(e)}`;
			}
		});
	}

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
	 * @returns {Promise<string | { error: import("./fake-acp-agent.d.mts").RpcErrorStep } | null>} a stopReason or an error a step forced, or null
	 */
	async function play(sessionId, steps, prompt) {
		for (const step of steps) {
			// A string delay is filled from the prompt, so one session can finish at different times.
			if (step.delayMs) await sleep(Number(fill(String(step.delayMs), prompt)));
			// claude-agent-acp's stamp on a helper's traffic when no sub-agent sessions are declared (#1025).
			const meta = step.parent
				? { _meta: { claudeCode: { parentToolUseId: step.parent } } }
				: {};
			if (step.say !== undefined) {
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(fill(step.say, prompt)),
					...meta,
				});
			}
			if (step.think !== undefined) {
				notify(sessionId, {
					sessionUpdate: "agent_thought_chunk",
					content: text(fill(step.think, prompt)),
				});
			}
			if (step.update) notify(sessionId, step.update);
			// A file the agent writes in its cwd, as an edit tool would (#1024).
			if (step.write)
				writeFileSync(
					join(cwd, step.write.path),
					fill(step.write.content, prompt),
				);
			if (step.tool) await tool(sessionId, step.tool, meta);
			// A loop that runs until stopped or `times` is reached, `{{i}}` filled per pass (#1101).
			if (step.repeat) {
				for (let i = 1; i <= step.repeat.times; i++) {
					if (cancelRequested) return "cancelled";
					const pass = JSON.parse(
						JSON.stringify(step.repeat.steps).replaceAll("{{i}}", String(i)),
					);
					const forced = await play(sessionId, pass, prompt);
					if (forced) return forced;
				}
			}
			// A process the agent leaves running, as a dev server would; its pid is said (#1101).
			if (step.spawn) {
				const child = spawn(
					process.execPath,
					["-e", "setInterval(() => {}, 60000)"],
					{ cwd, stdio: "ignore", windowsHide: true },
				);
				child.unref();
				// Also under the state dir, since a turn's text is stored only when it ends.
				mkdirSync(join(PICKED_DIR, "spawned"), { recursive: true });
				writeFileSync(
					join(PICKED_DIR, "spawned", sessionId),
					String(child.pid),
				);
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(`${step.spawn.say} (pid ${child.pid})\n`),
				});
			}
			if (step.subagent) await subagent(sessionId, step.subagent, prompt);
			if (step.elicit) {
				const answer = clientElicits
					? await elicit({ mode: "form", sessionId, ...step.elicit })
					: { action: "not-declared" };
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(`You answered: ${JSON.stringify(answer)}\n`),
				});
			}
			if (step.readLinks)
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(`${readLinks().join("\n") || "No linked files."}\n`),
				});
			// Without `--mcp` the host offers no gateway; say so rather than drop the call.
			if (step.call && !gateway)
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(
						`No PrismaLens gateway, so ${step.call.tool} did not run. Install the fake agent with \`node scripts/fakes/failure-case.mjs --install <bin-dir>\`.\n`,
					),
				});
			if (step.call && gateway) {
				/** @param {unknown} v @returns {unknown} */
				const subst = (v) =>
					typeof v === "string"
						? fill(v, prompt)
						: Array.isArray(v)
							? v.map(subst)
							: v && typeof v === "object"
								? Object.fromEntries(
										Object.entries(v).map(([k, x]) => [k, subst(x)]),
									)
								: v;
				const args = subst(step.call.arguments ?? {});
				const out = await mcpRequest("tools/call", {
					name: step.call.tool,
					arguments: args,
				}).catch((e) => ({ error: { message: String(e) } }));
				lastResult =
					out.error?.message ??
					(out.result?.content ?? []).map((c) => c.text ?? "").join("");
			}
			if (step.report) {
				const body = JSON.stringify(step.report, null, 2);
				notify(sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: text(`\n\`\`\`json\n${fill(body, prompt)}\n\`\`\`\n`),
				});
			}
			if (step.stderr) process.stderr.write(`${fill(step.stderr, prompt)}\n`);
			if (step.exit !== undefined) process.exit(step.exit);
			if (step.waitForCancel) {
				await new Promise((r) => {
					if (sessionId === rootSessionId) onCancel = () => r(undefined);
					else childCancels.set(sessionId, () => r(undefined));
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
			// Fields the prompt's answer carries, as an agent reports a turn's usage there (#1101).
			if (step.respond) respond = { ...respond, ...step.respond };
			if (step.stop) return step.stop;
			// The prompt answers with a JSON-RPC error, as an agent reports a usage limit (#1024).
			if (step.error) return { error: step.error };
		}
		return null;
	}

	/**
	 * A sub-agent as ACP's Subagent Sessions RFD streams one (#1025): announced on its
	 * parent, its steps in its own session, then its end state. A client that declared
	 * no sub-agents sees its steps on the parent, stamped with the call that started it.
	 * @param {string} parentId
	 * @param {import("./fake-acp-agent.d.mts").SubagentStep} sub
	 * @param {string} prompt
	 */
	async function subagent(parentId, sub, prompt) {
		if (!clientSubagents) {
			const steps = sub.steps.map((s) => ({ ...s, parent: sub.id }));
			await play(parentId, steps, prompt);
			return;
		}
		notify(parentId, {
			sessionUpdate: "subagent_update",
			sessionId: sub.id,
			title: sub.title,
			...(sub.description ? { description: sub.description } : {}),
			...(sub.cancel ? { capabilities: { cancel: {} } } : {}),
			state: { state: "running" },
		});
		const forced = await play(sub.id, sub.steps, prompt);
		const end = forced === "cancelled" ? "cancelled" : (sub.end ?? "end_turn");
		notify(parentId, {
			sessionUpdate: "subagent_update",
			sessionId: sub.id,
			state: { state: "idle", stopReason: end },
		});
	}

	/**
	 * Claude Code's shape: the call opens as "Terminal" with empty input, and the
	 * command arrives in a progress update before the permission request.
	 * @param {string} sessionId
	 * @param {import("./fake-acp-agent.d.mts").ToolStep} step
	 * @param {Record<string, unknown>} [meta]
	 */
	async function tool(sessionId, step, meta = {}) {
		// `{{cwd}}` in a call is the run's own copy, as a harness would print it.
		const t = JSON.parse(
			JSON.stringify(step)
				.replaceAll("{{cwd}}", JSON.stringify(cwd).slice(1, -1))
				.replace(/\{\{env:([A-Z0-9_]+)\}\}/g, (_, name) =>
					JSON.stringify(process.env[name] ?? "").slice(1, -1),
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
			...meta,
		});
		notify(sessionId, {
			sessionUpdate: "tool_call_update",
			toolCallId: t.id,
			status: "in_progress",
			title: t.title,
			rawInput: t.rawInput,
			...meta,
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
			...meta,
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
		// The agent's own compact command plays `compact` and is not one of the script's turns (#1024).
		if (script.compact && prompt.trim().split(/\s+/)[0] === "/compact") {
			const forced = await play(sessionId, script.compact, prompt);
			return typeof forced === "object" && forced
				? forced
				: { stopReason: forced ?? "end_turn" };
		}
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
					: (script.followUpWhen?.find((w) => prompt.includes(w.match))
							?.steps ??
						script.followUp ?? [{ say: "Heard: {{prompt}}" }]);
		respond = {};
		cancelRequested = false;
		const forced = await play(sessionId, steps, prompt);
		if (typeof forced === "object" && forced) return forced;
		return { ...respond, stopReason: forced ?? "end_turn" };
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
				clientSubagents =
					/** @type {{ clientCapabilities?: { subagents?: unknown } }} */ (
						msg.params ?? {}
					).clientCapabilities?.subagents != null;
				clientElicits = !!(
					/** @type {{ clientCapabilities?: { elicitation?: { form?: unknown } } }} */ (
						msg.params ?? {}
					).clientCapabilities?.elicitation?.form
				);
				return reply({
					protocolVersion: existsSync(join(CAPS_DIR, "protocolVersion"))
						? Number(readFileSync(join(CAPS_DIR, "protocolVersion"), "utf8"))
						: 1,
					agentInfo: script.agent ?? { name: "fake-acp-agent", version: "0" },
					agentCapabilities: {
						loadSession: script.loadSession !== false,
						promptCapabilities: { image: script.images === true },
						...(script.additionalDirectories ||
						existsSync(join(CAPS_DIR, "additionalDirectories"))
							? { sessionCapabilities: { additionalDirectories: {} } }
							: {}),
						...(mcp ? { mcpCapabilities: { http: true } } : {}),
					},
					authMethods: [],
				});
			case "session/new":
				sessionId = `fake-${Date.now().toString(36)}-${process.pid}`;
				rootSessionId = sessionId;
				await connect(msg.params?.mcpServers);
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
				rootSessionId = sessionId;
				await connect(msg.params?.mcpServers);
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
				links = blocks.filter(
					(/** @type {{ type?: string }} */ b) => b.type === "resource_link",
				);
				const images = blocks.filter(
					(/** @type {{ type?: string }} */ b) => b.type === "image",
				).length;
				const prompt =
					blocks
						.map((/** @type {{ text?: string }} */ b) => b.text ?? "")
						.join("") + (images ? `\n[${images} image(s) attached]` : "");
				if (turns === 0) {
					// The last one wins: a child's roster may quote its root's title, pick and all (#1024).
					const picked = [...prompt.matchAll(/fake-session:([a-z0-9-]+)/g)].at(
						-1,
					)?.[1];
					if (picked && picked !== scriptName) {
						script = loadSession(picked);
						scriptName = picked;
					}
					mkdirSync(PICKED_DIR, { recursive: true });
					writeFileSync(join(PICKED_DIR, sessionId), scriptName);
				}
				const answer = await turn(sessionId, prompt);
				if ("error" in answer && answer.error) {
					send({ jsonrpc: "2.0", id: msg.id, error: answer.error });
					return;
				}
				return reply(answer);
			}
			case "session/cancel": {
				const target = String(msg.params?.sessionId ?? "");
				const child = childCancels.get(target);
				if (child) {
					childCancels.delete(target);
					child();
					return;
				}
				cancelRequested = true;
				onCancel?.();
				onCancel = null;
				return;
			}
			default:
				if (msg.id !== undefined) reply({});
		}
	});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run();
