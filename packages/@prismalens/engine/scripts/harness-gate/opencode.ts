// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { openAcp } from "./acp.js";
import { harnessEnv } from "./env.js";
import type { Fixture } from "./fixture.js";
import {
	allowed,
	type Driver,
	type GateEvent,
	type GateOptions,
	sleep,
	type TurnResult,
	withTimeout,
} from "./session.js";

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

const config = (opts: GateOptions) => ({
	"experimental.continue_loop_on_deny": true,
	...(opts.isolate && {
		flags: ["--pure"],
		env: {
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		},
	}),
});

const versions = () => ({
	"opencode-ai": execFileSync("opencode", ["--version"]).toString().trim(),
});

export const opencodeAcp: Driver = {
	id: "opencode.acp",
	config,
	versions,
	open(fx, opts) {
		return openAcp(fx, {
			command: "opencode",
			args: ["acp", "--cwd", fx.repo, ...(opts.isolate ? ["--pure"] : [])],
			env: opencodeEnv(fx, opts, inlineConfig(fx, opts, false)),
		});
	},
};

export const opencodeNative: Driver = {
	id: "opencode.native-sdk",
	config,
	versions,
	async open(fx, opts) {
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
		const kill = () => {
			if (child.pid)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					// already gone
				}
		};
		const events: GateEvent[] = [];
		const stream = new AbortController();
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
				if (!sessionID) await sleep(500);
			}
			if (!sessionID)
				throw new Error(
					`session.create returned no id: ${JSON.stringify(lastError)}`,
				);
			const mainSession = sessionID;

			const answered = new Set<string>();
			const answer = async (p: {
				id: string;
				permission: string;
				patterns: string[];
				metadata: Record<string, unknown>;
			}) => {
				if (answered.has(p.id)) return;
				answered.add(p.id);
				const request = `${p.permission} ${p.patterns.join(" ")} ${JSON.stringify(p.metadata)}`;
				events.push({ t: Date.now(), kind: "permission", request });
				await client.permission.reply({
					requestID: p.id,
					reply: allowed(request, p.permission) ? "once" : "reject",
				});
			};
			const texts = new Map<string, string>();
			let turnStart = 0;
			let turnError: string | undefined;
			let onIdle: (() => void) | undefined;
			let connected: () => void = () => {};
			const isConnected = new Promise<void>((r) => {
				connected = r;
			});
			const sub = await client.event.subscribe(undefined, {
				signal: stream.signal,
			});
			void (async () => {
				try {
					for await (const ev of sub.stream) {
						const t = Date.now();
						if (ev.type === "server.connected") connected();
						if (ev.type === "permission.asked") await answer(ev.properties);
						if (ev.type === "message.part.updated") {
							const part = ev.properties.part;
							const parentId =
								part.sessionID !== mainSession ? part.sessionID : undefined;
							if (part.type === "text" && !parentId && t >= turnStart) {
								texts.set(part.id, part.text);
								events.push({ t, kind: "text", output: part.text });
							} else if (part.type === "reasoning")
								events.push({ t, kind: "delta", parentId });
							else if (part.type === "tool")
								events.push({
									t,
									kind: "tool",
									id: part.callID,
									name: part.tool,
									status: part.state.status,
									input: JSON.stringify(part.state.input),
									output:
										part.state.status === "completed"
											? part.state.output
											: part.state.status === "error"
												? part.state.error
												: undefined,
									parentId,
								});
						}
						if (
							ev.type === "session.error" &&
							(!ev.properties.sessionID ||
								ev.properties.sessionID === mainSession)
						)
							turnError = JSON.stringify(
								ev.properties.error ?? "session.error",
							);
						if (
							ev.type === "session.idle" &&
							ev.properties.sessionID === mainSession
						)
							onIdle?.();
					}
				} catch {
					// the stream is aborted on close
				}
			})();
			// A request raised before the event stream connects is never delivered on it.
			await withTimeout(isConnected, 10_000, undefined);
			const backstop = setInterval(() => {
				void client.permission
					.list()
					.then((res) => Promise.all((res.data ?? []).map(answer)))
					.catch(() => {});
			}, 2_000);

			return {
				events,
				async prompt(text, timeoutMs): Promise<TurnResult> {
					texts.clear();
					turnStart = Date.now();
					turnError = undefined;
					const idle = new Promise<boolean>((resolve) => {
						onIdle = () => resolve(true);
					});
					const sent = await client.session.promptAsync({
						sessionID: mainSession,
						model: { providerID: "ollama", modelID: opts.model },
						parts: [{ type: "text", text }],
					});
					if (sent.error)
						return {
							settled: true,
							ended: false,
							text: "",
							error: JSON.stringify(sent.error),
						};
					const settled = await withTimeout(idle, timeoutMs, false);
					const messages = await client.session.messages({
						sessionID: mainSession,
					});
					const last = [...(messages.data ?? [])]
						.reverse()
						.find((m) => m.info.role === "assistant");
					const error =
						turnError ??
						(last?.info.role === "assistant" && last.info.error
							? JSON.stringify(last.info.error)
							: undefined);
					return {
						settled,
						ended: settled && !error,
						text: (last?.parts ?? [])
							.map((p) => (p.type === "text" ? p.text : ""))
							.join(""),
						error,
					};
				},
				async cancel() {
					await client.session.abort({ sessionID: mainSession });
				},
				async close() {
					clearInterval(backstop);
					stream.abort();
					kill();
				},
			};
		} catch (e) {
			stream.abort();
			kill();
			throw e;
		}
	},
};
