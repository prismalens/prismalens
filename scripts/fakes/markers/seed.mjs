// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Seeds the isolation rows' markers (#1180) into each agent's own config files: a hook, a user and
// a project MCP server, and Codex and OpenCode plugins. Each agent keeps them in its own layout.
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = resolve(dirname(fileURLToPath(import.meta.url)), "marker.mjs");
const node = process.execPath.replaceAll("\\", "/");
const marker = (dir, name, mcp = false) => ({
	command: node,
	args: [
		MARKER.replaceAll("\\", "/"),
		dir.replaceAll("\\", "/"),
		name,
		...(mcp ? ["mcp"] : []),
	],
});
const shell = (dir, name) => {
	const m = marker(dir, name);
	return [m.command, ...m.args].map((a) => `"${a}"`).join(" ");
};

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}
function mergeJson(path, add) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ ...readJson(path), ...add }, null, 2));
}
const toml = (s) => `'${s}'`;

/** The user-scope markers, in the agent's own (scratch) home from `env`. */
export function seedUser(harness, env, markers) {
	const hook = (name) => ({
		hooks: [{ type: "command", command: shell(markers, name) }],
	});
	if (harness === "claude-code") {
		const dir = env.CLAUDE_CONFIG_DIR;
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
		const home = env.CODEX_HOME;
		const mkt = join(home, "mk-marketplace");
		const plugin = (root) => {
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
		const dir = join(env.XDG_CONFIG_HOME, "opencode");
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
		const path = join(env.GEMINI_CLI_HOME, ".gemini", "settings.json");
		mergeJson(path, {
			mcpServers: { "mk-user": marker(markers, "mcp-user", true) },
			hooks: { SessionStart: [hook("user-hook")] },
		});
	}
}

/** The project-scope markers, in the session's own folder. */
export function seedProject(harness, cwd, env, markers) {
	const hook = (name) => ({
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
			join(env.CODEX_HOME, "config.toml"),
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
