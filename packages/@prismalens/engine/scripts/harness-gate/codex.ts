// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Codex, type ThreadItem } from "@openai/codex-sdk";
import { openAcp } from "./acp.js";
import { harnessEnv } from "./env.js";
import type { Fixture } from "./fixture.js";
import type { Driver, GateEvent, GateOptions, TurnResult } from "./session.js";

const pkgVersion = (name: string) =>
	(
		JSON.parse(
			readFileSync(
				join(
					import.meta.dirname,
					"..",
					"..",
					"node_modules",
					name,
					"package.json",
				),
				"utf8",
			),
		) as { version: string }
	).version;

const toml = (v: string) => JSON.stringify(v);

/** Writes a per-run CODEX_HOME whose only provider is loopback Ollama; returns the env for the harness. */
function codexHome(
	fx: Fixture,
	opts: GateOptions,
	withMcp: boolean,
): Record<string, string> {
	const home = join(fx.home, ".codex");
	mkdirSync(home, { recursive: true });
	const lines = [
		`model = ${toml(opts.model)}`,
		`model_provider = "gate_ollama"`,
		`approval_policy = "on-request"`,
		`sandbox_mode = "read-only"`,
		"",
		"[model_providers.gate_ollama]",
		`name = "Ollama"`,
		`base_url = ${toml(`${opts.baseUrl}/v1`)}`,
		`wire_api = "responses"`,
	];
	if (withMcp)
		lines.push(
			"",
			"[mcp_servers.probe]",
			`command = ${toml(fx.probe.command)}`,
			`args = [${fx.probe.args.map(toml).join(", ")}]`,
			`env = { ${Object.entries(fx.probe.env)
				.map(([k, v]) => `${k} = ${toml(v)}`)
				.join(", ")} }`,
		);
	writeFileSync(join(home, "config.toml"), `${lines.join("\n")}\n`);
	return harnessEnv(fx.home, {
		CODEX_HOME: home,
		INITIAL_AGENT_MODE: "read-only",
	});
}

const config = () => ({
	approval_policy: "on-request",
	sandbox_mode: "read-only",
	"codex-acp INITIAL_AGENT_MODE": "read-only",
});

export const codexAcp: Driver = {
	id: "codex.acp",
	config,
	versions: () => ({
		"@agentclientprotocol/codex-acp": pkgVersion(
			"@agentclientprotocol/codex-acp",
		),
	}),
	open(fx, opts) {
		const dir = join(
			import.meta.dirname,
			"..",
			"..",
			"node_modules",
			"@agentclientprotocol",
			"codex-acp",
		);
		return openAcp(fx, {
			command: process.execPath,
			args: [join(dir, "dist", "index.js")],
			env: codexHome(fx, opts, false),
		});
	},
};

function itemEvent(item: ThreadItem, t: number): GateEvent | undefined {
	switch (item.type) {
		case "agent_message":
			return { t, kind: "text", output: item.text };
		case "reasoning":
			return { t, kind: "delta" };
		case "command_execution":
			return {
				t,
				kind: "tool",
				id: item.id,
				name: "shell",
				status: item.status,
				input: JSON.stringify(item.command),
				output: item.aggregated_output,
			};
		case "file_change":
			return {
				t,
				kind: "tool",
				id: item.id,
				name: "file_change",
				status: item.status,
				input: JSON.stringify(item.changes),
			};
		case "mcp_tool_call":
			return {
				t,
				kind: "tool",
				id: item.id,
				name: `${item.server}.${item.tool}`,
				status: item.status,
				input: JSON.stringify(item.arguments ?? {}),
				output: JSON.stringify(item.result?.content ?? item.error ?? undefined),
			};
		default:
			return undefined;
	}
}

/**
 * The official TypeScript SDK drives `codex exec --experimental-json`, which has no channel for a
 * client to answer approvals; a native driver with per-call approval would need `codex app-server`.
 */
export const codexNative: Driver = {
	id: "codex.native-sdk",
	config,
	versions: () => ({ "@openai/codex-sdk": pkgVersion("@openai/codex-sdk") }),
	async open(fx, opts) {
		const env = codexHome(fx, opts, true);
		const codex = new Codex({ env });
		const thread = codex.startThread({
			model: opts.model,
			workingDirectory: fx.repo,
			sandboxMode: "read-only",
			approvalPolicy: "on-request",
			skipGitRepoCheck: true,
		});
		const events: GateEvent[] = [];
		let current: AbortController | undefined;
		return {
			events,
			async prompt(text, timeoutMs): Promise<TurnResult> {
				const abort = new AbortController();
				current = abort;
				const timer = setTimeout(() => abort.abort(), timeoutMs);
				let turnText = "";
				let error: string | undefined;
				let completed = false;
				try {
					const { events: stream } = await thread.runStreamed(text, {
						signal: abort.signal,
					});
					for await (const ev of stream) {
						const t = Date.now();
						if (
							ev.type === "item.started" ||
							ev.type === "item.updated" ||
							ev.type === "item.completed"
						) {
							const e = itemEvent(ev.item, t);
							if (e) events.push(e);
							if (
								ev.type === "item.completed" &&
								ev.item.type === "agent_message"
							)
								turnText += ev.item.text;
						}
						if (ev.type === "turn.completed") completed = true;
						if (ev.type === "turn.failed") error = ev.error.message;
						if (ev.type === "error") error = ev.message;
					}
				} catch (e) {
					error ??= String(e);
				} finally {
					clearTimeout(timer);
				}
				const settled = completed || Boolean(error);
				return { settled, ended: completed && !error, text: turnText, error };
			},
			async cancel() {
				current?.abort();
			},
			async close() {
				current?.abort();
			},
		};
	},
};
