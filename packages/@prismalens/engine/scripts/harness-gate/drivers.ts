// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { type Fixture, observe, PROMPT } from "./fixture.js";
import type { Observation } from "./verdict.js";

export interface GateOptions {
	model: string;
	baseUrl: string;
	/** Apply the setting that keeps repo-supplied config inert (R4). */
	isolate: boolean;
	timeoutMs: number;
}

export interface Driver {
	id: string;
	/** The settings a passing run needs, recorded beside the result. */
	config(opts: GateOptions): Record<string, unknown>;
	versions(): Record<string, string>;
	run(fx: Fixture, opts: GateOptions): Promise<Observation>;
}

/** Neither harness package exports `package.json` or a main, so read them from the engine's node_modules. */
const pkgDir = (name: string) =>
	join(import.meta.dirname, "..", "..", "node_modules", name);
const pkgJson = (name: string) =>
	JSON.parse(readFileSync(join(pkgDir(name), "package.json"), "utf8")) as {
		version: string;
		bin?: Record<string, string>;
	};
const pkgVersion = (name: string) => pkgJson(name).version;

/** Points Claude Code at an Anthropic-compatible endpoint (Ollama locally) with no API key. */
function claudeEnv(fx: Fixture, opts: GateOptions): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env))
		if (v !== undefined) env[k] = v;
	return {
		...env,
		CLAUDE_CONFIG_DIR: fx.home,
		ANTHROPIC_BASE_URL: opts.baseUrl,
		ANTHROPIC_AUTH_TOKEN: process.env.GATE_AUTH_TOKEN ?? "ollama",
		ANTHROPIC_API_KEY: "",
		ANTHROPIC_MODEL: opts.model,
		ANTHROPIC_DEFAULT_HAIKU_MODEL: opts.model,
		ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model,
		ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model,
		CLAUDE_CODE_SUBAGENT_MODEL: opts.model,
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	};
}

const refusesWrites = (text: string) => !/prismalens_probe/.test(text);

export const claudeNative: Driver = {
	id: "claude-code.native-sdk",
	config: (opts) => (opts.isolate ? { settingSources: [] } : {}),
	versions: () => ({
		"@anthropic-ai/claude-agent-sdk": pkgVersion(
			"@anthropic-ai/claude-agent-sdk",
		),
	}),
	async run(fx, opts) {
		const permissionRequests: string[] = [];
		const toolCalls: string[] = [];
		let finalText = "";
		let ended = false;
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), opts.timeoutMs);
		try {
			for await (const m of query({
				prompt: PROMPT,
				options: {
					cwd: fx.repo,
					model: opts.model,
					env: claudeEnv(fx, opts),
					abortController: abort,
					permissionMode: "default",
					mcpServers: { probe: { type: "stdio", ...fx.probe } },
					...(opts.isolate && { settingSources: [] }),
					canUseTool: async (toolName, input) => {
						const text = `${toolName} ${JSON.stringify(input)}`;
						permissionRequests.push(text);
						return refusesWrites(text)
							? {
									behavior: "deny",
									message: "prismalens read-only policy refused this tool call",
								}
							: { behavior: "allow", updatedInput: input };
					},
				},
			})) {
				if (m.type === "assistant")
					for (const b of m.message.content)
						if (b.type === "tool_use")
							toolCalls.push(`${b.name} ${JSON.stringify(b.input)}`);
				if (m.type === "result") {
					finalText = "result" in m ? (m.result ?? "") : "";
					ended = true;
				}
			}
		} catch {
			ended = false;
		} finally {
			clearTimeout(timer);
		}
		return observe(fx, { finalText, permissionRequests, toolCalls, ended });
	},
};

export const claudeAcp: Driver = {
	id: "claude-code.acp",
	config: (opts) =>
		opts.isolate
			? { "session/new._meta.claudeCode.options.settingSources": [] }
			: {},
	versions: () => ({
		"@agentclientprotocol/claude-agent-acp": pkgVersion(
			"@agentclientprotocol/claude-agent-acp",
		),
	}),
	async run(fx, opts) {
		const name = "@agentclientprotocol/claude-agent-acp";
		const bin = join(
			pkgDir(name),
			pkgJson(name).bin?.["claude-agent-acp"] ?? "dist/index.js",
		);
		const child = spawn(process.execPath, [bin], {
			cwd: fx.repo,
			env: claudeEnv(fx, opts),
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
					refusesWrites(text) && p.toolCall.kind !== "read"
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
				...(opts.isolate && {
					_meta: { claudeCode: { options: { settingSources: [] } } },
				}),
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
			// The adapter spawns the claude CLI and MCP servers; kill the whole group.
			if (child.pid) process.kill(-child.pid, "SIGKILL");
		}
		return observe(fx, { finalText, permissionRequests, toolCalls, ended });
	},
};

export const DRIVERS: Record<string, Driver> = {
	[claudeNative.id]: claudeNative,
	[claudeAcp.id]: claudeAcp,
};
