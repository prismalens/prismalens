// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The isolation rows (#1180 §0, R1, §3.4): seed marker hooks, plugins and MCP servers into the
 * agent's own home and the session's folder, fire them once with no isolation (the positive
 * control), then assert none fires under a check path (`probe`) or a clean-profile turn (`clean`).
 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_REGISTRY, versionOf } from "@prismalens/agent-host";
import type { HarnessId } from "@prismalens/config/harness";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import {
	CheckNotIsolatedError,
	isolateCheck,
	probeHarness,
} from "../src/run/harness-doctor.js";
import { prepareRunEnv } from "../src/run/investigate.js";
import { readAgentLimits } from "../src/run/limits-read.js";
import { nameThread } from "../src/run/name-thread.js";
import { deny } from "../src/run/permission.js";
import { AcpSession } from "../src/runner/acp-client.js";

const MARKER = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../scripts/fakes/markers/marker.mjs",
);
/** Server names PrismaLens would find in the agent's config files (§3.1), turned off by name. */
const FOUND_MCP = ["mk-user", "mk-project"];

const node = process.execPath.replaceAll("\\", "/");
const marker = (dir: string, name: string, mcp = false) => ({
	command: node,
	args: [
		MARKER.replaceAll("\\", "/"),
		dir.replaceAll("\\", "/"),
		name,
		...(mcp ? ["mcp"] : []),
	],
});
const shell = (dir: string, name: string) => {
	const m = marker(dir, name);
	return [m.command, ...m.args].map((a) => `"${a}"`).join(" ");
};

function readJson(path: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}
function mergeJson(path: string, add: Record<string, unknown>): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ ...readJson(path), ...add }, null, 2));
}
const toml = (s: string) => `'${s}'`;

/** The user-scope markers, in the agent's own (scratch) home from `env`. */
export function seedUser(
	harness: HarnessId,
	env: NodeJS.ProcessEnv,
	markers: string,
): void {
	const hook = (name: string) => ({
		hooks: [{ type: "command", command: shell(markers, name) }],
	});
	if (harness === "claude-code") {
		const dir = env.CLAUDE_CONFIG_DIR as string;
		mergeJson(join(dir, "settings.json"), {
			hooks: {
				SessionStart: [hook("user-hook")],
				UserPromptSubmit: [hook("user-prompt-hook")],
			},
		});
		mergeJson(join(dir, ".claude.json"), {
			mcpServers: { "mk-user": marker(markers, "mcp-user", true) },
		});
	} else if (harness === "codex") {
		const home = env.CODEX_HOME as string;
		const mkt = join(home, "mk-marketplace");
		const plugin = (root: string) => {
			mkdirSync(join(root, ".codex-plugin"), { recursive: true });
			writeFileSync(
				join(root, ".codex-plugin", "plugin.json"),
				JSON.stringify({
					name: "mk-plugin",
					version: "0.0.1",
					mcpServers: "./.mcp.json",
				}),
			);
			writeFileSync(
				join(root, ".mcp.json"),
				JSON.stringify({
					mcpServers: { "mk-plugin-mcp": marker(markers, "mcp-plugin", true) },
				}),
			);
		};
		mkdirSync(join(mkt, ".agents", "plugins"), { recursive: true });
		writeFileSync(
			join(mkt, ".agents", "plugins", "marketplace.json"),
			JSON.stringify({
				name: "mk",
				interface: { displayName: "Markers" },
				plugins: [
					{
						name: "mk-plugin",
						source: { source: "local", path: "./plugins/mk-plugin" },
						policy: { installation: "AVAILABLE" },
						category: "Productivity",
					},
				],
			}),
		);
		plugin(join(mkt, "plugins", "mk-plugin"));
		plugin(join(home, "plugins", "cache", "mk", "mk-plugin", "0.0.1"));
		const m = marker(markers, "mcp-user", true);
		appendFileSync(
			join(home, "config.toml"),
			[
				"",
				"[mcp_servers.mk-user]",
				`command = ${toml(m.command)}`,
				`args = [${m.args.map(toml).join(", ")}]`,
				"",
				"[marketplaces.mk]",
				'source_type = "local"',
				`source = ${toml(mkt)}`,
				"",
				'[plugins."mk-plugin@mk"]',
				"enabled = true",
				"",
			].join("\n"),
		);
		writeFileSync(
			join(home, "hooks.json"),
			JSON.stringify({ hooks: { SessionStart: [hook("user-hook")] } }),
		);
	} else if (harness === "opencode") {
		const dir = join(env.XDG_CONFIG_HOME as string, "opencode");
		const m = marker(markers, "mcp-user", true);
		mergeJson(join(dir, "opencode.json"), {
			mcp: {
				"mk-user": {
					type: "local",
					command: [m.command, ...m.args],
					enabled: true,
				},
			},
		});
		const write = `appendFileSync(${JSON.stringify(join(markers, "plugin"))}, "loaded\\n")`;
		mkdirSync(join(dir, "plugin"), { recursive: true });
		// 1.x calls each exported function; 2.x takes one default definition.
		writeFileSync(
			join(dir, "plugin", "mk1.js"),
			`import { appendFileSync } from "node:fs";\nexport const Mk = async () => { ${write}; return {}; };\n`,
		);
		writeFileSync(
			join(dir, "plugin", "mk2.js"),
			`import { appendFileSync } from "node:fs";\nexport default { id: "mk", setup: async () => { ${write}; return {}; } };\n`,
		);
	} else if (harness === "gemini") {
		const path = join(
			env.GEMINI_CLI_HOME as string,
			".gemini",
			"settings.json",
		);
		mergeJson(path, {
			mcpServers: { "mk-user": marker(markers, "mcp-user", true) },
			hooks: { SessionStart: [hook("user-hook")] },
		});
	}
}

/** The project-scope markers, in the session's own folder. */
export function seedProject(
	harness: HarnessId,
	cwd: string,
	env: NodeJS.ProcessEnv,
	markers: string,
): void {
	const hook = (name: string) => ({
		hooks: [{ type: "command", command: shell(markers, name) }],
	});
	const server = marker(markers, "mcp-project", true);
	if (harness === "claude-code") {
		mergeJson(join(cwd, ".mcp.json"), { mcpServers: { "mk-project": server } });
		mergeJson(join(cwd, ".claude", "settings.json"), {
			hooks: { SessionStart: [hook("project-hook")] },
		});
	} else if (harness === "codex") {
		mkdirSync(join(cwd, ".codex"), { recursive: true });
		writeFileSync(
			join(cwd, ".codex", "config.toml"),
			`[mcp_servers.mk-project]\ncommand = ${toml(server.command)}\nargs = [${server.args.map(toml).join(", ")}]\n`,
		);
		writeFileSync(
			join(cwd, ".codex", "hooks.json"),
			JSON.stringify({ hooks: { SessionStart: [hook("project-hook")] } }),
		);
		appendFileSync(
			join(env.CODEX_HOME as string, "config.toml"),
			`\n[projects.${toml(cwd)}]\ntrust_level = "trusted"\n`,
		);
	} else if (harness === "opencode") {
		mergeJson(join(cwd, "opencode.json"), {
			mcp: {
				"mk-project": {
					type: "local",
					command: [server.command, ...server.args],
					enabled: true,
				},
			},
		});
	} else if (harness === "gemini") {
		mergeJson(join(cwd, ".gemini", "settings.json"), {
			mcpServers: { "mk-project": server },
			hooks: { SessionStart: [hook("project-hook")] },
		});
	}
}

/** The markers each launch left, then an empty folder for the next. */
function take(markers: string): string[] {
	const seen = readdirSync(markers).sort();
	for (const f of seen) rmSync(join(markers, f), { force: true });
	return seen;
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One session and one turn on `harness` in `cwd`, with the clean profile or the user's own. */
async function sessionAndTurn(
	harness: HarnessId,
	cwd: string,
	clean: boolean,
): Promise<string | null> {
	const runDir = mkdtempSync(join(tmpdir(), "pl-matrix-iso-"));
	try {
		const prepared = prepareRunEnv({
			harness,
			cwd,
			runDir,
			hostEnv: process.env,
		});
		const rowMeta = AGENT_REGISTRY[harness].sessionMeta?.();
		const use = clean ? (AGENT_REGISTRY[harness].cleanProfile ?? null) : null;
		if (clean && !use) return "the agent has no clean profile";
		const plan = await isolateCheck(
			harness,
			{
				env: prepared.env,
				args: prepared.args,
				...(rowMeta ? { sessionMeta: rowMeta } : {}),
			},
			{
				requireIsolation: clean,
				probeIsolation: use,
				mcp: FOUND_MCP,
				runDir,
				versionOf: () =>
					versionOf(
						prepared.runEnv.companionPath ?? prepared.launch.command,
						undefined,
						prepared.env,
					),
			},
		);
		const s = new AcpSession({
			command: prepared.launch.command,
			args: plan.args,
			cwd,
			env: plan.env,
			...(plan.sessionMeta ? { sessionMeta: plan.sessionMeta } : {}),
			permission: (req) =>
				deny(req, "denied", "the isolation row refuses every ask"),
			initTimeoutMs: 60_000,
			promptTimeoutMs: 60_000,
		});
		try {
			await s.open();
			for await (const item of s.prompt("Say hello."))
				if (item.kind === "done" || item.kind === "error") break;
		} finally {
			await s.close().catch(() => undefined);
		}
		return null;
	} catch (err) {
		return err instanceof CheckNotIsolatedError
			? `no clean profile: ${err.message}`
			: null;
	} finally {
		rmSync(runDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
	}
}

/** Runs one isolation row; a problem, or null on a pass, and what it saw. */
export async function runIsolationRow(
	row: Row,
	harness: HarnessId,
): Promise<{ problem: string | null; saw: string }> {
	const markers = mkdtempSync(join(tmpdir(), "pl-matrix-markers-"));
	const controls = row.markers?.[harness] ?? [];
	const seen: string[] = [];
	const seed = (cwd: string) => seedProject(harness, cwd, process.env, markers);
	try {
		seedUser(harness, process.env, markers);
		if (!controls.length)
			return {
				problem: `no positive control is declared for ${harness}`,
				saw: "",
			};
		const workspace = mkdtempSync(join(tmpdir(), "pl-matrix-iso-ws-"));
		const control = async () => {
			if (row.run.isolation === "clean")
				await sessionAndTurn(harness, workspace, false);
			else
				await probeHarness(harness, {
					probeIsolation: null,
					seedWorkspace: seed,
					sandbox: async () => ({}),
				});
			await settle(1_000);
		};
		if (row.run.isolation === "clean") seed(workspace);
		await control();
		const fired = take(markers);
		seen.push(`own: ${fired.join(",") || "none"}`);
		const missing = controls.filter((m) => !fired.includes(m));
		if (missing.length)
			return {
				problem: `the positive control did not fire ${missing.join(",")}`,
				saw: seen.join("; "),
			};

		const paths: [string, () => Promise<string | null>][] =
			row.run.isolation === "clean"
				? [
						[
							"clean session and turn",
							() => sessionAndTurn(harness, workspace, true),
						],
					]
				: [
						[
							"background pass",
							async () => {
								try {
									await probeHarness(harness, {
										requireIsolation: true,
										mcp: FOUND_MCP,
										seedWorkspace: seed,
										sandbox: async () => ({}),
									});
									return null;
								} catch (err) {
									return err instanceof CheckNotIsolatedError
										? `no safe check: ${err.message}`
										: String(err);
								}
							},
						],
						[
							"Check",
							async () => {
								await probeHarness(harness, {
									mcp: FOUND_MCP,
									seedWorkspace: seed,
									sandbox: async () => ({}),
								});
								return null;
							},
						],
						[
							"title",
							async () => {
								await nameThread(harness, {
									prompt: "Name this thread.",
									mcp: FOUND_MCP,
									seedWorkspace: seed,
									timeoutMs: 60_000,
								}).catch(() => undefined);
								return null;
							},
						],
						[
							"limit read",
							async () => {
								await readAgentLimits(harness).catch(() => null);
								return null;
							},
						],
					];
		for (const [name, run] of paths) {
			const refused = await run();
			await settle(1_000);
			const left = take(markers);
			seen.push(`${name}: ${refused ?? (left.join(",") || "none")}`);
			if (refused)
				return { problem: `${name}: ${refused}`, saw: seen.join("; ") };
			if (left.length)
				return {
					problem: `${name} fired ${left.join(",")}`,
					saw: seen.join("; "),
				};
		}
		return { problem: null, saw: seen.join("; ") };
	} finally {
		if (existsSync(markers)) rmSync(markers, { recursive: true, force: true });
	}
}
