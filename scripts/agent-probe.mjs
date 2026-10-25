#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The protocol probe (#914): installs an agent and sends `initialize` and `session/new`
 * with no model behind it, then reports what the agent answered next to the version the
 * registry row was tested on. It spends no tokens and warns no user.
 *
 *   agent-probe.mjs --all [--registry <built harness.js>]   latest release of every row, as a table
 *   agent-probe.mjs --agent <id> --version <v> [--companion <v>]   one version; exit 1 when it fails
 */
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const WINDOWS = process.platform === "win32";
const STEP_MS = 90_000;

/** One entry per agent row: where its ACP server comes from and how to start it. */
export const ROWS = [
	{ id: "opencode", npm: "opencode-ai", bin: "opencode", args: ["acp"] },
	{
		id: "claude-code",
		npm: "@agentclientprotocol/claude-agent-acp",
		bin: "claude-agent-acp",
		args: [],
	},
	{
		id: "codex",
		npm: "@agentclientprotocol/codex-acp",
		bin: "codex-acp",
		args: [],
		// Like dcode, codex refuses `session/new` with no key; this one never reaches a model (#914).
		env: { OPENAI_API_KEY: "probe-no-model", CODEX_API_KEY: "probe-no-model" },
		home: "CODEX_HOME",
	},
	{
		id: "gemini",
		npm: "@google/gemini-cli",
		bin: "gemini",
		args: ["--experimental-acp"],
		env: { GEMINI_API_KEY: "probe-no-model" },
		home: "GEMINI_CLI_HOME",
	},
	{
		id: "deepagents",
		pip: ["deepagents-code", "deepagents-acp"],
		bin: "dcode",
		args: ["--acp", "--no-mcp"],
		// dcode refuses `initialize` with no provider key; this one never reaches a model (#914).
		env: { OPENAI_API_KEY: "probe-no-model" },
	},
];

/** The CLI an adapter drives, and the env var that names it. */
const COMPANIONS = {
	"claude-code": {
		npm: "@anthropic-ai/claude-code",
		bin: "claude",
		env: "CLAUDE_CODE_EXECUTABLE",
	},
	codex: { npm: "@openai/codex", bin: "codex", env: "CODEX_PATH" },
};

const run = (file, args, options = {}) =>
	execFileSync(file, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: WINDOWS,
		...options,
	});

/** The latest stable release of an npm package. */
export function latestOf(pkg) {
	return run("npm", ["view", pkg, "version"]).trim();
}

/** Installs the row at `version` under `dir`; returns the command and env to start it. */
function install(row, version, dir, companion) {
	if (row.npm) {
		const specs = [`${row.npm}@${version}`];
		if (companion && COMPANIONS[row.id])
			specs.push(`${COMPANIONS[row.id].npm}@${companion}`);
		run("npm", [
			"install",
			"--prefix",
			dir,
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			...specs,
		]);
		const bin = join(dir, "node_modules", ".bin");
		return {
			command: join(bin, row.bin),
			env: {
				PATH: `${bin}${delimiter}${process.env.PATH}`,
				...(companion && COMPANIONS[row.id]
					? { [COMPANIONS[row.id].env]: join(bin, COMPANIONS[row.id].bin) }
					: {}),
				// Its own empty home, so no runner sign-in or config is read.
				...(row.home ? { [row.home]: join(dir, "home") } : {}),
				...row.env,
			},
		};
	}
	// deepagents-code needs Python 3.14, which uv fetches when the runner has none.
	const venv = join(dir, "venv");
	run("uv", ["venv", "--quiet", "--python", "3.14", venv]);
	const bin = join(venv, WINDOWS ? "Scripts" : "bin");
	run("uv", [
		"pip",
		"install",
		"--quiet",
		"--python",
		join(bin, WINDOWS ? "python.exe" : "python"),
		...row.pip.map((p, i) => (i === 0 && version ? `${p}==${version}` : p)),
	]);
	return {
		command: join(bin, row.bin),
		env: {
			PATH: `${bin}${delimiter}${process.env.PATH}`,
			// Its own empty profile, so no user config or sign-in is read.
			DEEPAGENTS_HOME: join(dir, "profile"),
			...row.env,
		},
	};
}

/** `initialize` then `session/new` over stdio; every failure is an answer, not an exception. */
export function speak({ command, env }, args, cwd) {
	return new Promise((resolve) => {
		const out = { initialize: null, session: null, stderr: "" };
		// Windows runs a .cmd shim only through a shell; anything else spawns directly.
		const shim = WINDOWS && /\.(cmd|bat)$/i.test(command);
		const child = spawn(shim ? `"${command}"` : command, args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
			shell: shim,
		});
		let buffer = "";
		const waiting = new Map();
		const done = () => {
			child.kill();
			resolve(out);
		};
		// An agent that closes stdin early is reported by the exit handler, not a crash.
		child.stdin.on("error", () => {});
		child.stderr.on("data", (d) => {
			out.stderr = `${out.stderr}${d}`.slice(-600);
		});
		child.on("error", (e) => {
			out.initialize ??= { error: { message: e.message } };
			done();
		});
		child.on("exit", () => {
			for (const [, finish] of waiting)
				finish({ error: { message: `exited early: ${out.stderr.trim()}` } });
		});
		child.stdout.on("data", (d) => {
			buffer += d;
			for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				try {
					const msg = JSON.parse(line);
					if (msg.id !== undefined && !msg.method && waiting.has(msg.id))
						waiting.get(msg.id)(msg);
				} catch {
					// a banner or log line
				}
			}
		});
		const ask = (id, method, params) =>
			new Promise((answer) => {
				const timer = setTimeout(
					() => answer({ error: { message: `${method} timed out` } }),
					STEP_MS,
				);
				waiting.set(id, (msg) => {
					clearTimeout(timer);
					answer(msg);
				});
				child.stdin.write(
					`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
				);
			});
		(async () => {
			out.initialize = await ask(1, "initialize", {
				protocolVersion: 1,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			});
			if (out.initialize.result)
				out.session = await ask(2, "session/new", { cwd, mcpServers: [] });
			done();
		})();
	});
}

/** One line of what an agent answered. */
export function summarize(answer) {
	const init = answer.initialize?.result;
	const session = answer.session?.result;
	if (!init)
		return {
			ok: false,
			text: `initialize failed: ${answer.initialize?.error?.message ?? "no answer"}`,
		};
	const caps = init.agentCapabilities ?? {};
	const flags = [
		caps.loadSession ? "loadSession" : null,
		caps.promptCapabilities?.image ? "image" : null,
		caps.mcpCapabilities ? "mcp" : null,
	].filter(Boolean);
	const agent = init.agentInfo
		? `${init.agentInfo.name} ${init.agentInfo.version}`
		: "no agentInfo";
	const auth = (init.authMethods ?? []).map((m) => m.id).join(",") || "none";
	if (!session)
		return {
			ok: false,
			text: `initialize ok (protocol ${init.protocolVersion}, ${agent}); session/new failed: ${answer.session?.error?.message ?? "no answer"}`,
		};
	const modes = session.modes?.availableModes?.length ?? 0;
	const options = (session.configOptions ?? [])
		.map((o) => o.category)
		.filter(Boolean)
		.join(",");
	return {
		ok: true,
		text: `protocol ${init.protocolVersion}, ${agent}; caps ${flags.join("+") || "none"}; auth ${auth}; session/new ok, ${modes} modes, options ${options || "none"}`,
	};
}

async function probeOne(row, version, companion) {
	const dir = mkdtempSync(join(tmpdir(), `pl-probe-${row.id}-`));
	if (row.home) mkdirSync(join(dir, "home"));
	try {
		const started = install(row, version, dir, companion);
		const cwd = mkdtempSync(join(dir, "cwd-"));
		return summarize(await speak(started, row.args, cwd));
	} catch (e) {
		return {
			ok: false,
			text: `install failed: ${String(e.stderr ?? e.message)
				.trim()
				.slice(-200)}`,
		};
	} finally {
		try {
			rmSync(dir, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 500,
			});
		} catch {
			// Windows keeps a killed shim's files open; the runner's temp dir is thrown away.
		}
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			all: { type: "boolean" },
			agent: { type: "string" },
			version: { type: "string" },
			companion: { type: "string" },
			registry: { type: "string" },
		},
	});
	if (values.agent) {
		const row = ROWS.find((r) => r.id === values.agent);
		if (!row || !values.version) {
			console.error(
				"usage: agent-probe.mjs --agent <id> --version <v> [--companion <v>]",
			);
			process.exit(2);
		}
		const result = await probeOne(row, values.version, values.companion);
		console.log(`${row.id} ${values.version}: ${result.text}`);
		process.exit(result.ok ? 0 : 1);
	}
	if (!values.all) {
		console.error("usage: agent-probe.mjs --all | --agent <id> --version <v>");
		process.exit(2);
	}
	const registry = values.registry
		? (await import(pathToFileURL(values.registry).href)).HARNESS_REGISTRY
		: {};
	const lines = [
		"| Agent | Latest release | Tested | Probe (initialize, session/new; no model) |",
		"| :--- | :--- | :--- | :--- |",
	];
	for (const row of ROWS) {
		let latest = "";
		try {
			latest = row.npm ? latestOf(row.npm) : "";
		} catch {
			latest = "unknown";
		}
		const result = await probeOne(row, latest, undefined);
		const tested = registry[row.id]?.tested?.version ?? "none";
		lines.push(
			`| ${row.id} | ${latest || "latest"} | ${tested} | ${result.ok ? "ok" : "FAILS"}: ${result.text} |`,
		);
	}
	const table = lines.join("\n");
	console.log(table);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
	// An agent's grandchildren can outlive the kill and hold the event loop open.
	process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
