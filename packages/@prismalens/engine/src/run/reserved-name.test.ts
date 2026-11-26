// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryFs } from "./__fixtures__/memory-fs.js";
import { userServerByOurName } from "./reserved-name.js";

describe("userServerByOurName (#1101)", () => {
	const home = resolve("/home/user");
	const cwd = resolve(home, "project");
	const env = { HOME: home, USERPROFILE: home };
	const ours = JSON.stringify({ mcpServers: { prismalens: { command: "node" } } });

	it("finds a prismalens server in Claude Code's top-level mcpServers", () => {
		const path = resolve(home, ".claude.json");
		expect(
			userServerByOurName("claude-code", env, cwd, memoryFs({ [path]: ours })),
		).toBe(path);
	});

	it("finds a prismalens server in Claude Code's projects[cwd].mcpServers", () => {
		const path = resolve(home, ".claude.json");
		const fs = memoryFs({
			[path]: JSON.stringify({
				projects: { [cwd]: { mcpServers: { prismalens: { command: "node" } } } },
			}),
		});
		expect(userServerByOurName("claude-code", env, cwd, fs)).toBe(path);
	});

	it("reads .claude.json from CLAUDE_CONFIG_DIR when it is set", () => {
		const dir = resolve(home, "claude-alt");
		const path = resolve(dir, ".claude.json");
		const fs = memoryFs({ [path]: ours, [resolve(home, ".claude.json")]: "{}" });
		expect(
			userServerByOurName("claude-code", { ...env, CLAUDE_CONFIG_DIR: dir }, cwd, fs),
		).toBe(path);
	});

	it("finds a prismalens server in the project's .mcp.json after 500 skills", () => {
		const path = resolve(cwd, ".mcp.json");
		const skills = Object.fromEntries(
			Array.from({ length: 500 }, (_, i) => [resolve(home, ".claude", "skills", `s${i}`, "SKILL.md"), "x"]),
		);
		expect(
			userServerByOurName("claude-code", env, cwd, memoryFs({ ...skills, [path]: ours })),
		).toBe(path);
	});

	it("finds a prismalens server in the project's .mcp.json", () => {
		const path = resolve(cwd, ".mcp.json");
		expect(
			userServerByOurName("claude-code", env, cwd, memoryFs({ [path]: ours })),
		).toBe(path);
	});

	it("finds a prismalens server in Codex's config.toml mcp_servers", () => {
		const path = resolve(home, ".codex", "config.toml");
		const fs = memoryFs({ [path]: '[mcp_servers.prismalens]\ncommand = "python"\n' });
		expect(userServerByOurName("codex", env, cwd, fs)).toBe(path);
	});

	it("finds a prismalens server in the project's Gemini settings.json", () => {
		const path = resolve(cwd, ".gemini", "settings.json");
		expect(
			userServerByOurName("gemini", env, cwd, memoryFs({ [path]: ours })),
		).toBe(path);
	});

	it("finds a prismalens server under OpenCode's mcp key", () => {
		const path = resolve(cwd, "opencode.json");
		const fs = memoryFs({
			[path]: JSON.stringify({ mcp: { prismalens: { type: "local" } } }),
		});
		expect(userServerByOurName("opencode", env, cwd, fs)).toBe(path);
	});

	it("returns null for an agent with no config layout", () => {
		const fs = memoryFs({ [resolve(cwd, ".mcp.json")]: ours });
		expect(userServerByOurName("unknown-harness", env, cwd, fs)).toBeNull();
	});

	it("returns null when cwd is undefined", () => {
		const fs = memoryFs({ [resolve(home, ".claude.json")]: ours });
		expect(userServerByOurName("claude-code", env, undefined, fs)).toBeNull();
	});

	it("returns null when a read throws", () => {
		const fs = {
			text: () => {
				throw new Error("Disk read error");
			},
			dirs: () => null,
		};
		expect(userServerByOurName("claude-code", env, cwd, fs)).toBeNull();
	});
});
