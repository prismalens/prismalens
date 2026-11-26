// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryFs } from "./__fixtures__/memory-fs.js";
import { foundMcpNames, readOnDisk } from "./agent-config.js";

const home = resolve("/home/user");
const repo = resolve(home, "src", "app");
const env = { HOME: home, USERPROFILE: home };
const h = (...p: string[]) => resolve(home, ...p);
const r = (...p: string[]) => resolve(repo, ...p);
const SECRET = "S3NTINEL-secret";

/** Rows as (kind, name, scope, state, path, extras) so a failure reads as a table. */
const rows = (items: ReturnType<typeof readOnDisk>) =>
	items.map((i) => [
		i.kind,
		i.name,
		i.scope,
		i.state,
		i.path,
		...(i.via ? [`via ${i.via}`] : []),
		...(i.transport ? [i.transport] : []),
	]);

describe("readOnDisk (#1180 §3.1)", () => {
	it("Claude Code: global and project files, both MCP scopes as two rows, AGENTS.md only beside no CLAUDE.md", () => {
		const fs = memoryFs({
			[h(".claude", "CLAUDE.md")]: "mine",
			[h(".claude", "skills", "triage", "SKILL.md")]: "x",
			[h(".claude", "skills", "notes", "README.md")]: "not a skill",
			[h(".claude", "settings.json")]: JSON.stringify({
				hooks: { PreToolUse: [] },
				enabledPlugins: { "lint@market": true, "old@market": false },
			}),
			[h(".claude.json")]: JSON.stringify({
				mcpServers: {
					docs: { command: "docs-mcp", args: [SECRET], env: { TOKEN: SECRET } },
				},
				projects: {
					[repo]: { mcpServers: { db: { type: "http", url: `https://${SECRET}@db/x` } } },
				},
			}),
			[r(".mcp.json")]: JSON.stringify({
				mcpServers: { docs: { type: "sse", url: "https://docs/sse", headers: { A: SECRET } } },
			}),
			[r("CLAUDE.md")]: "repo",
			[r("AGENTS.md")]: "skipped: CLAUDE.md is here",
			[resolve(repo, "..", "AGENTS.md")]: "read: no CLAUDE.md beside it",
			[r(".claude", "settings.json")]: JSON.stringify({ hooks: { Stop: [] } }),
		});
		const items = readOnDisk("claude-code", env, repo, fs);
		expect(rows(items)).toEqual([
			["instructions", "CLAUDE.md", "global", "found", h(".claude", "CLAUDE.md")],
			["instructions", "CLAUDE.md", "repo", "found", r("CLAUDE.md")],
			["instructions", "AGENTS.md", "repo", "found", resolve(repo, "..", "AGENTS.md")],
			["skill", "triage", "global", "found", h(".claude", "skills", "triage")],
			["mcp", "docs", "global", "found", h(".claude.json"), "stdio"],
			["mcp", "db", "repo", "in-project", h(".claude.json"), "http"],
			["mcp", "docs", "repo", "in-project", r(".mcp.json"), "sse"],
			["hook", "PreToolUse", "global", "found", h(".claude", "settings.json")],
			["hook", "Stop", "repo", "in-project", r(".claude", "settings.json")],
			["plugin", "lint@market", "global", "found", h(".claude", "settings.json")],
			["plugin", "old@market", "global", "off", h(".claude", "settings.json")],
		]);
		expect(JSON.stringify(items)).not.toContain(SECRET);
		expect(JSON.stringify(items)).not.toContain("docs-mcp");
	});

	it("Claude Code: CLAUDE_CONFIG_DIR moves .claude.json, settings and skills", () => {
		const dir = h("alt");
		const fs = memoryFs({
			[resolve(dir, ".claude.json")]: JSON.stringify({ mcpServers: { alt: { command: "a" } } }),
			[h(".claude.json")]: JSON.stringify({ mcpServers: { ignored: { command: "b" } } }),
			[resolve(dir, "settings.json")]: JSON.stringify({ hooks: { Stop: [] } }),
		});
		expect(rows(readOnDisk("claude-code", { ...env, CLAUDE_CONFIG_DIR: dir }, null, fs))).toEqual([
			["mcp", "alt", "global", "found", resolve(dir, ".claude.json"), "stdio"],
			["hook", "Stop", "global", "found", resolve(dir, "settings.json")],
		]);
	});

	it("Codex: the override wins over AGENTS.md, ~/.agents/skills, a disabled server is off, project TOML", () => {
		const fs = memoryFs({
			[h(".codex", "AGENTS.override.md")]: "o",
			[h(".codex", "AGENTS.md")]: "skipped",
			[h(".agents", "skills", "deploy", "SKILL.md")]: "x",
			[h(".codex", "config.toml")]: [
				"[mcp_servers.docs]",
				`command = "docs"`,
				`args = ["${SECRET}"]`,
				"[mcp_servers.old]",
				`command = "old"`,
				"enabled = false",
				"[plugins.review]",
				"enabled = true",
			].join("\n"),
			[r(".codex", "config.toml")]: `[mcp_servers.web]\nurl = "https://web/mcp?key=${SECRET}"\n`,
			[r("AGENTS.md")]: "repo",
		});
		const items = readOnDisk("codex", env, repo, fs);
		expect(rows(items)).toEqual([
			["instructions", "AGENTS.override.md", "global", "found", h(".codex", "AGENTS.override.md")],
			["instructions", "AGENTS.md", "repo", "found", r("AGENTS.md")],
			["skill", "deploy", "global", "found", h(".agents", "skills", "deploy")],
			["mcp", "docs", "global", "found", h(".codex", "config.toml"), "stdio"],
			["mcp", "old", "global", "off", h(".codex", "config.toml"), "stdio"],
			["mcp", "web", "repo", "in-project", r(".codex", "config.toml"), "http"],
			["plugin", "review", "global", "found", h(".codex", "config.toml")],
		]);
		expect(JSON.stringify(items)).not.toContain(SECRET);
	});

	it("OpenCode: Claude's files via claude-code only where no AGENTS.md, plugins as a list", () => {
		const fs = memoryFs({
			[h(".claude", "CLAUDE.md")]: "read: no opencode AGENTS.md",
			[h(".claude", "skills", "triage", "SKILL.md")]: "x",
			[h(".config", "opencode", "opencode.jsonc")]: `{
				// comments are allowed
				"mcp": { "docs": { "type": "local", "command": ["docs"], "environment": { "K": "${SECRET}" } } },
			}`,
			[h(".config", "opencode", "opencode.json")]: JSON.stringify({ plugin: ["opencode-wakatime"] }),
			[r("AGENTS.md")]: "repo",
			[r("CLAUDE.md")]: "skipped: AGENTS.md is here",
			[r("opencode.json")]: JSON.stringify({ mcp: { web: { type: "remote", url: "https://w", enabled: false } } }),
		});
		const items = readOnDisk("opencode", env, repo, fs);
		expect(rows(items)).toEqual([
			["instructions", "CLAUDE.md", "global", "found", h(".claude", "CLAUDE.md"), "via claude-code"],
			["instructions", "AGENTS.md", "repo", "found", r("AGENTS.md")],
			["skill", "triage", "global", "found", h(".claude", "skills", "triage"), "via claude-code"],
			["mcp", "docs", "global", "found", h(".config", "opencode", "opencode.jsonc"), "stdio"],
			["mcp", "web", "repo", "off", r("opencode.json"), "http"],
			["plugin", "opencode-wakatime", "global", "found", h(".config", "opencode", "opencode.json")],
		]);
		expect(JSON.stringify(items)).not.toContain(SECRET);
	});

	it("Gemini: GEMINI_CLI_HOME, extensions as folders, a settings file that does not parse is failed", () => {
		const gh = h("gem");
		const fs = memoryFs({
			[resolve(gh, ".gemini", "GEMINI.md")]: "g",
			[resolve(gh, ".gemini", "extensions", "jira", "gemini-extension.json")]: "{}",
			[resolve(gh, ".gemini", "settings.json")]: JSON.stringify({
				mcpServers: { docs: { httpUrl: "https://d" } },
				hooks: { BeforeTool: [] },
			}),
			[r(".gemini", "settings.json")]: "{ not json",
		});
		expect(rows(readOnDisk("gemini", { ...env, GEMINI_CLI_HOME: gh }, repo, fs))).toEqual([
			["instructions", "GEMINI.md", "global", "found", resolve(gh, ".gemini", "GEMINI.md")],
			["mcp", "docs", "global", "found", resolve(gh, ".gemini", "settings.json"), "http"],
			["mcp", "settings.json", "repo", "failed", r(".gemini", "settings.json")],
			["hook", "BeforeTool", "global", "found", resolve(gh, ".gemini", "settings.json")],
			["hook", "settings.json", "repo", "failed", r(".gemini", "settings.json")],
			["plugin", "jira", "global", "found", resolve(gh, ".gemini", "extensions", "jira")],
		]);
	});

	it("an agent with no layout reads nothing", () => {
		const fs = memoryFs({ [r(".mcp.json")]: JSON.stringify({ mcpServers: { a: {} } }) });
		expect(readOnDisk("cursor", env, repo, fs)).toEqual([]);
	});
});

describe("foundMcpNames (#1180 R1)", () => {
	const fs = memoryFs({
		[h(".claude.json")]: JSON.stringify({ mcpServers: { docs: {}, prismalens: {} } }),
		[r(".mcp.json")]: JSON.stringify({ mcpServers: { docs: {}, db: {} } }),
	});

	it("names each server once across scopes, project ones only with a project", () => {
		expect(foundMcpNames("claude-code", env, repo, fs)).toEqual(["docs", "prismalens", "db"]);
		expect(foundMcpNames("claude-code", env, null, fs)).toEqual(["docs", "prismalens"]);
	});

	it("leaves out the names the launch sends itself", () => {
		expect(foundMcpNames("claude-code", env, null, fs, ["prismalens"])).toEqual(["docs"]);
	});
});
