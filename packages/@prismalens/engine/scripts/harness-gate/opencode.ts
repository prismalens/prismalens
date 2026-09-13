// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { Driver, GateOptions } from "./drivers.js";
import { harnessEnv } from "./env.js";
import { type Fixture, observe, PROMPT } from "./fixture.js";

const refuse = (text: string) => !/prismalens_probe/.test(text);

/** Inline config: an Ollama provider (no key) and ask-before-edit/bash, the policy prismalens answers. */
function inlineConfig(fx: Fixture, opts: GateOptions, withMcp: boolean) {
	return {
		$schema: "https://opencode.ai/config.json",
		model: `ollama/${opts.model}`,
		provider: {
			ollama: {
				npm: "@ai-sdk/openai-compatible",
				name: "Ollama",
				options: { baseURL: `${opts.baseUrl}/v1`, apiKey: "ollama" },
				models: { [opts.model]: { name: opts.model, tool_call: true } },
			},
		},
		permission: { edit: "ask", bash: "ask", webfetch: "deny" },
		share: "disabled",
		autoupdate: false,
		// Without this OpenCode ends the turn on the first refused tool call, so no report ever arrives.
		experimental: { continue_loop_on_deny: true },
		...(withMcp && {
			mcp: {
				probe: {
					type: "local",
					command: [fx.probe.command, ...fx.probe.args],
					environment: fx.probe.env,
					enabled: true,
				},
			},
		}),
	};
}

function opencodeEnv(
	fx: Fixture,
	opts: GateOptions,
	config: object,
): Record<string, string> {
	// Provider packages are downloaded into the cache; share it across runs so each run does not refetch.
	const cache = join(homedir(), ".cache", "prismalens-harness-gate");
	mkdirSync(cache, { recursive: true });
	return harnessEnv(fx.home, {
		XDG_CONFIG_HOME: join(fx.home, "config"),
		XDG_DATA_HOME: join(fx.home, "data"),
		XDG_STATE_HOME: join(fx.home, "state"),
		XDG_CACHE_HOME: cache,
		OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
		OPENCODE_DISABLE_AUTOUPDATE: "1",
		...(opts.isolate && {
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		}),
	});
}

const isolationConfig = (opts: GateOptions) => ({
	"experimental.continue_loop_on_deny": true,
	...(opts.isolate && {
		flags: ["--pure"],
		env: {
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		},
	}),
});

const opencodeVersion = () => {
	const out = spawn("opencode", ["--version"]);
	return new Promise<string>((resolve) => {
		let v = "";
		out.stdout.on("data", (d) => {
			v += d;
		});
		out.on("close", () => resolve(v.trim()));
	});
};
let cachedVersion = "unknown";
void opencodeVersion().then((v) => {
	cachedVersion = v;
});

const killGroup = (child: ChildProcess) => {
	if (child.pid) {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
};

export const opencodeAcp: Driver = {
	id: "opencode.acp",
	config: isolationConfig,
	versions: () => ({ "opencode-ai": cachedVersion }),
	async run(fx, opts) {
		const args = ["acp", "--cwd", fx.repo, ...(opts.isolate ? ["--pure"] : [])];
		const child = spawn("opencode", args, {
			cwd: fx.repo,
			env: opencodeEnv(fx, opts, inlineConfig(fx, opts, false)),
			stdio: ["pipe", "pipe", "ignore"],
			detached: true,
		});
		const permissionRequests: string[] = [];
		const toolCalls: string[] = [];
		let finalText = "";
		const client: Client = {
			async requestPermission(p) {
				const text = `${p.toolCall.title ?? ""} ${JSON.stringify(p.toolCall.rawInput ?? {})}`;
				permissionRequests.push(text);
				const kind =
					refuse(text) && p.toolCall.kind !== "read"
						? "reject_once"
						: "allow_once";
				const option = p.options.find((o) => o.kind === kind) ?? p.options[0];
				return { outcome: { outcome: "selected", optionId: option.optionId } };
			},
			async sessionUpdate(n) {
				const u = n.update;
				if (
					u.sessionUpdate === "tool_call" ||
					u.sessionUpdate === "tool_call_update"
				)
					toolCalls.push(
						`${u.title ?? ""} ${JSON.stringify(u.rawInput ?? {})}`,
					);
				if (
					u.sessionUpdate === "agent_message_chunk" &&
					u.content.type === "text"
				)
					finalText += u.content.text;
			},
		};
		const conn = new ClientSideConnection(
			() => client,
			ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
		);
		const timeout = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), opts.timeoutMs),
		);
		let ended = false;
		try {
			await conn.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {},
			});
			const session = await conn.newSession({
				cwd: fx.repo,
				mcpServers: [
					{
						name: "probe",
						command: fx.probe.command,
						args: fx.probe.args,
						env: Object.entries(fx.probe.env).map(([name, value]) => ({
							name,
							value,
						})),
					},
				],
			});
			const res = await Promise.race([
				conn.prompt({
					sessionId: session.sessionId,
					prompt: [{ type: "text", text: PROMPT }],
				}),
				timeout,
			]);
			ended = res !== null && Boolean(res.stopReason);
		} catch {
			ended = false;
		} finally {
			killGroup(child);
		}
		return observe(fx, { finalText, permissionRequests, toolCalls, ended });
	},
};

export const opencodeNative: Driver = {
	id: "opencode.native-sdk",
	config: isolationConfig,
	versions: () => ({ "opencode-ai": cachedVersion }),
	async run(fx, opts) {
		const child = spawn(
			"opencode",
			[
				"serve",
				"--hostname=127.0.0.1",
				"--port=0",
				...(opts.isolate ? ["--pure"] : []),
			],
			{
				cwd: fx.repo,
				env: opencodeEnv(fx, opts, inlineConfig(fx, opts, true)),
				stdio: ["ignore", "pipe", "ignore"],
				detached: true,
			},
		);
		const permissionRequests: string[] = [];
		const toolCalls = new Map<string, string>();
		let finalText = "";
		let ended = false;
		let error: string | undefined;
		const events = new AbortController();
		try {
			const baseUrl = await new Promise<string>((resolve, reject) => {
				let out = "";
				const t = setTimeout(
					() => reject(new Error("opencode serve did not start")),
					30_000,
				);
				child.stdout?.on("data", (d) => {
					out += d;
					const m = out.match(/listening on\s+(https?:\/\/\S+)/);
					if (m) {
						clearTimeout(t);
						resolve(m[1]);
					}
				});
			});
			const client = createOpencodeClient({ baseUrl, directory: fx.repo });
			// `serve` prints its URL before the project instance finishes booting.
			let sessionID: string | undefined;
			let lastError: unknown;
			for (let attempt = 0; attempt < 10 && !sessionID; attempt++) {
				const created = await client.session.create({});
				sessionID = created.data?.id;
				lastError = created.error;
				if (!sessionID) await new Promise((r) => setTimeout(r, 500));
			}
			if (!sessionID)
				throw new Error(
					`session.create returned no id: ${JSON.stringify(lastError)}`,
				);
			const answered = new Set<string>();
			const answer = async (p: {
				id: string;
				permission: string;
				patterns: string[];
				metadata: Record<string, unknown>;
			}) => {
				if (answered.has(p.id)) return;
				answered.add(p.id);
				const text = `${p.permission} ${p.patterns.join(" ")} ${JSON.stringify(p.metadata)}`;
				permissionRequests.push(text);
				await client.permission.reply({
					requestID: p.id,
					reply: refuse(text) ? "reject" : "once",
				});
			};
			const sub = await client.event.subscribe(undefined, {
				signal: events.signal,
			});
			let connected: () => void = () => {};
			const isConnected = new Promise<void>((r) => {
				connected = r;
			});
			const idle = (async () => {
				for await (const ev of sub.stream) {
					if (ev.type === "server.connected") connected();
					if (ev.type === "permission.asked") await answer(ev.properties);
					if (
						ev.type === "message.part.updated" &&
						ev.properties.part.type === "tool"
					) {
						const part = ev.properties.part;
						const input =
							"input" in part.state ? JSON.stringify(part.state.input) : "{}";
						toolCalls.set(part.callID, `${part.tool} ${input}`);
					}
					if (
						ev.type === "session.idle" &&
						ev.properties.sessionID === sessionID
					)
						return true;
				}
				return false;
			})();
			// A request raised before the event stream connects is never delivered on it.
			await Promise.race([
				isConnected,
				new Promise((r) => setTimeout(r, 10_000)),
			]);
			const backstop = setInterval(() => {
				void client.permission
					.list()
					.then((res) => Promise.all((res.data ?? []).map(answer)))
					.catch(() => {});
			}, 2_000);
			await client.session.promptAsync({
				sessionID,
				model: { providerID: "ollama", modelID: opts.model },
				parts: [{ type: "text", text: PROMPT }],
			});
			ended =
				(await Promise.race([
					idle,
					new Promise<boolean>((r) =>
						setTimeout(() => r(false), opts.timeoutMs),
					),
				])) === true;
			clearInterval(backstop);
			const messages = await client.session.messages({ sessionID });
			const last = [...(messages.data ?? [])]
				.reverse()
				.find((m) => m.info.role === "assistant");
			finalText = (last?.parts ?? [])
				.map((p) => (p.type === "text" ? p.text : ""))
				.join("");
		} catch (e) {
			ended = false;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			events.abort();
			killGroup(child);
		}
		return observe(fx, {
			finalText,
			permissionRequests,
			toolCalls: [...toolCalls.values()],
			ended,
			error,
		});
	},
};
