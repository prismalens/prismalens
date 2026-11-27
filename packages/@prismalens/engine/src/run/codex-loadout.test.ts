// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCodexLoadout } from "./codex-loadout.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "fake-codex-app-server.mjs");
const AT = new Date("2026-11-26T10:00:00.000Z");

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pl-codex-loadout-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A Codex home with a user server and a project server, the project trusted or not. */
function world(trusted: boolean) {
	const home = join(dir, "codex-home");
	const repo = join(dir, "repo");
	mkdirSync(join(repo, ".codex"), { recursive: true });
	mkdirSync(home, { recursive: true });
	writeFileSync(
		join(home, "config.toml"),
		`[mcp_servers.docs]\ncommand = "docs"\n${trusted ? `\n[projects.${JSON.stringify(process.platform === "win32" ? resolve(repo).toLowerCase() : resolve(repo))}]\ntrust_level = "trusted"\n` : ""}`,
	);
	writeFileSync(join(repo, ".codex", "config.toml"), `[mcp_servers.db]\ncommand = "db"\n`);
	return { home, repo };
}

/** Answers shaped as Codex 0.171.0 gave them on a scratch home (config layers, skills, hooks, plugins). */
const answers = (home: string, repo: string) => ({
	"config/read": {
		config: {},
		origins: {},
		layers: [
			{ name: { type: "sessionFlags" }, version: "1", config: { mcp_servers: { docs: { enabled: false } } } },
			{ name: { type: "project", dotCodexFolder: join(repo, ".codex") }, version: "1", disabledReason: "add it as a trusted project", config: { mcp_servers: { db: { command: "db" } } } },
			{ name: { type: "user", file: join(home, "config.toml") }, version: "1", config: { mcp_servers: { docs: { command: "docs" }, old: { command: "o", enabled: false } }, plugins: {} } },
		],
	},
	"skills/list": { data: [{ cwd: repo, errors: [], skills: [{ name: "triage", path: join(home, "skills", "triage"), scope: "user", enabled: true }, { name: "lint", path: join(repo, ".agents", "skills", "lint"), scope: "repo", enabled: false }] }] },
	"hooks/list": { data: [{ cwd: repo, errors: [], warnings: [], hooks: [{ eventName: "sessionStart", source: "user", sourcePath: join(home, "hooks.json"), enabled: true, trustStatus: "untrusted" }, { eventName: "stop", source: "sessionFlags", sourcePath: join(home, "x"), enabled: true, trustStatus: "trusted" }] }] },
	"plugin/installed": { marketplaces: [{ name: "mk", plugins: [{ id: "mk-plugin@mk", name: "mk-plugin", enabled: true, installed: true }, { id: "other@mk", name: "other", enabled: true, installed: false }] }] },
});

function plan(home: string, extra: Record<string, string> = {}) {
	return {
		command: process.execPath,
		args: [FAKE],
		cwd: dir,
		env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", CODEX_HOME: home, ...extra },
	};
}

describe("readCodexLoadout (#1180 §3.1)", () => {
	it("reports the user and project layers but never the overrides layer, skills, hooks and installed plugins, each as reported now", async () => {
		const { home, repo } = world(false);
		const items = await readCodexLoadout(
			plan(home, { FAKE_CODEX_ANSWERS: JSON.stringify(answers(home, repo)) }),
			repo,
			{ home: dir, now: () => AT },
		);
		expect(items?.map((i) => [i.kind, i.name, i.scope, i.state, i.path, i.reported])).toEqual([
			["mcp", "db", "repo", "untrusted", resolve(repo, ".codex", "config.toml"), AT.toISOString()],
			["mcp", "docs", "global", "loads", resolve(home, "config.toml"), AT.toISOString()],
			["mcp", "old", "global", "off", resolve(home, "config.toml"), AT.toISOString()],
			["skill", "triage", "global", "loads", resolve(home, "skills", "triage"), AT.toISOString()],
			["skill", "lint", "repo", "off", resolve(repo, ".agents", "skills", "lint"), AT.toISOString()],
			["hook", "SessionStart", "global", "untrusted", resolve(home, "hooks.json"), AT.toISOString()],
			["plugin", "mk-plugin@mk", "global", "loads", null, AT.toISOString()],
		]);
	});

	it("turns off exactly the servers Codex lists for the selected folder, as one inline table keyed by each literal name", async () => {
		// Codex 0.171.0 lists a trusted root's project server from a subfolder of it, by its own trust rules.
		const argsFile = join(dir, "args.json");
		const cwdFile = join(dir, "cwd.txt");
		const { home, repo } = world(false);
		const sub = join(repo, "sub", "deep");
		mkdirSync(sub, { recursive: true });
		const names = ["docs", "db", "docs.v2", `we ird="x'`, "dökü"];
		await readCodexLoadout(
			plan(home, { FAKE_CODEX_ARGS: argsFile, FAKE_CODEX_MCP_CWD: cwdFile, FAKE_CODEX_MCP_LIST: JSON.stringify(names) }),
			sub,
			{ home: dir },
		);
		const args = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
		const value = (args[2] ?? "").replace(/^mcp_servers=/, "");
		expect([
			resolve(readFileSync(cwdFile, "utf8")),
			args.slice(0, 2),
			args.length,
			parseToml(`t = ${value}`).t,
		]).toEqual([
			resolve(sub),
			["app-server", "-c"],
			3,
			Object.fromEntries(names.map((n) => [n, { enabled: false }])),
		]);
	});

	it("is null, and starts no app-server, when Codex gives no server list", async () => {
		const argsFile = join(dir, "args.json");
		const { home, repo } = world(true);
		const items = await readCodexLoadout(plan(home, { FAKE_CODEX_ARGS: argsFile, FAKE_CODEX_MCP_LIST: "fail" }), repo, { home: dir });
		expect([items, existsSync(argsFile)]).toEqual([null, false]);
	});

	it("shows one row for an event's handlers in one file, loading if any of them is trusted", async () => {
		const { home, repo } = world(false);
		const file = join(home, "hooks.json");
		const handler = (key: string, trustStatus: string) => ({ key, eventName: "sessionStart", source: "user", sourcePath: file, enabled: true, trustStatus });
		const hooks = (...hs: object[]) => ({ "hooks/list": { data: [{ cwd: repo, errors: [], warnings: [], hooks: hs }] } });
		const states = async (...hs: object[]) =>
			(await readCodexLoadout(plan(home, { FAKE_CODEX_ANSWERS: JSON.stringify(hooks(...hs)) }), repo, { home: dir }))?.map((i) => [i.name, i.state]);
		expect([
			await states(handler("a", "untrusted"), handler("b", "trusted")),
			await states(handler("a", "trusted"), handler("b", "untrusted")),
			await states(handler("a", "untrusted"), handler("b", "modified")),
		]).toEqual([[["SessionStart", "loads"]], [["SessionStart", "loads"]], [["SessionStart", "untrusted"]]]);
	});

	it("is null when an initialized CLI holds a loadout call past its budget", async () => {
		const asked = join(dir, "asked.txt");
		const { home, repo } = world(false);
		const items = await readCodexLoadout(plan(home, { FAKE_CODEX_HOLD: "config/read", FAKE_CODEX_ASKED: asked }), repo, {
			home: dir,
			budgetMs: 1_000,
		});
		expect([items, readFileSync(asked, "utf8").trim().split("\n")]).toEqual([null, ["initialize", "initialized", "config/read"]]);
	});
});
