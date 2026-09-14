// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { openAcp } from "./acp.js";
import { harnessEnv } from "./env.js";
import type { Fixture } from "./fixture.js";
import {
	allowed,
	type Driver,
	type GateEvent,
	type GateOptions,
	Inbox,
	type TurnResult,
	withTimeout,
} from "./session.js";

/** Neither harness package exports `package.json` or a main, so read them from the engine's node_modules. */
const pkgDir = (name: string) =>
	join(import.meta.dirname, "..", "..", "node_modules", name);
const pkgJson = (name: string) =>
	JSON.parse(readFileSync(join(pkgDir(name), "package.json"), "utf8")) as {
		version: string;
		bin?: Record<string, string>;
	};

/** Points Claude Code at a loopback Anthropic-compatible endpoint (Ollama) with a placeholder token. */
function claudeEnv(fx: Fixture, opts: GateOptions): Record<string, string> {
	return harnessEnv(fx.home, {
		CLAUDE_CONFIG_DIR: fx.home,
		ANTHROPIC_BASE_URL: opts.baseUrl,
		ANTHROPIC_AUTH_TOKEN: "ollama",
		ANTHROPIC_API_KEY: "",
		ANTHROPIC_MODEL: opts.model,
		ANTHROPIC_DEFAULT_HAIKU_MODEL: opts.model,
		ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model,
		ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model,
		CLAUDE_CODE_SUBAGENT_MODEL: opts.model,
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	});
}

const str = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));

export const claudeNative: Driver = {
	id: "claude-code.native-sdk",
	config: (opts) => (opts.isolate ? { settingSources: [] } : {}),
	versions: () => ({
		"@anthropic-ai/claude-agent-sdk": pkgJson("@anthropic-ai/claude-agent-sdk")
			.version,
	}),
	async open(fx, opts) {
		const events: GateEvent[] = [];
		const inbox = new Inbox<SDKUserMessage>();
		const abort = new AbortController();
		const q = query({
			prompt: inbox,
			options: {
				cwd: fx.repo,
				model: opts.model,
				env: claudeEnv(fx, opts),
				abortController: abort,
				permissionMode: "default",
				includePartialMessages: true,
				mcpServers: { probe: { type: "stdio", ...fx.probe } },
				...(opts.isolate && { settingSources: [] }),
				canUseTool: async (toolName, input) => {
					const request = `${toolName} ${JSON.stringify(input)}`;
					events.push({ t: Date.now(), kind: "permission", request });
					return allowed(request, toolName === "Read" ? "read" : undefined)
						? { behavior: "allow", updatedInput: input }
						: {
								behavior: "deny",
								message: "prismalens read-only policy refused this tool call",
							};
				},
			},
		});
		let turnText = "";
		let finishTurn: ((r: TurnResult) => void) | undefined;
		const pump = (async () => {
			try {
				for await (const m of q) {
					const t = Date.now();
					const parentId =
						"parent_tool_use_id" in m
							? (m.parent_tool_use_id ?? undefined)
							: undefined;
					if (m.type === "stream_event")
						events.push({ t, kind: "delta", parentId });
					if (m.type === "assistant")
						for (const b of m.message.content) {
							if (b.type === "text" && !parentId) {
								turnText += b.text;
								events.push({ t, kind: "text", output: b.text });
							}
							if (b.type === "tool_use")
								events.push({
									t,
									kind: "tool",
									id: b.id,
									name: b.name,
									status: "started",
									input: str(b.input),
									parentId,
								});
						}
					if (m.type === "user" && Array.isArray(m.message.content))
						for (const b of m.message.content)
							if (typeof b === "object" && b.type === "tool_result")
								events.push({
									t,
									kind: "tool",
									id: b.tool_use_id,
									status: b.is_error ? "failed" : "completed",
									output: str(b.content),
									parentId,
								});
					if (m.type === "result") {
						finishTurn?.({
							settled: true,
							ended: m.subtype === "success" && !m.is_error,
							text: turnText,
						});
						finishTurn = undefined;
					}
				}
			} catch (e) {
				finishTurn?.({
					settled: true,
					ended: false,
					text: turnText,
					error: String(e),
				});
			}
		})();
		return {
			events,
			prompt(text, timeoutMs) {
				turnText = "";
				const done = new Promise<TurnResult>((resolve) => {
					finishTurn = resolve;
				});
				inbox.push({
					type: "user",
					message: { role: "user", content: text },
					parent_tool_use_id: null,
				});
				return withTimeout(done, timeoutMs, {
					settled: false,
					ended: false,
					text: turnText,
				});
			},
			async cancel() {
				await q.interrupt();
			},
			async close() {
				inbox.end();
				abort.abort();
				await withTimeout(pump, 5_000, undefined);
			},
		};
	},
};

export const claudeAcp: Driver = {
	id: "claude-code.acp",
	config: (opts) =>
		opts.isolate
			? { "session/new._meta.claudeCode.options.settingSources": [] }
			: {},
	versions: () => ({
		"@agentclientprotocol/claude-agent-acp": pkgJson(
			"@agentclientprotocol/claude-agent-acp",
		).version,
	}),
	open(fx, opts) {
		const name = "@agentclientprotocol/claude-agent-acp";
		return openAcp(fx, {
			command: process.execPath,
			args: [
				join(
					pkgDir(name),
					pkgJson(name).bin?.["claude-agent-acp"] ?? "dist/index.js",
				),
			],
			env: claudeEnv(fx, opts),
			sessionExtra: opts.isolate
				? { _meta: { claudeCode: { options: { settingSources: [] } } } }
				: undefined,
		});
	},
};
