// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Seeds the isolation rows' markers (#1180) into each agent's own config files: a hook, a user and
// a project MCP server, and Codex and OpenCode plugins. Each agent keeps them in its own layout.
import {
	appendFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
const toml = (s) => `'${s}'`;

const ROOT_VAR = {
	"claude-code": "CLAUDE_CONFIG_DIR",
	codex: "CODEX_HOME",
	opencode: "XDG_CONFIG_HOME",
	gemini: "GEMINI_CLI_HOME",
};
/** The env var naming `harness`'s config folder, which the markers go in. */
export const configVar = (harness) => ROOT_VAR[harness];
const within = (path, root) => {
	const rel = relative(root, path);
	return !rel.startsWith("..") && !isAbsolute(rel);
};
/** A workspace folder PrismaLens made: `<temp>/pl-*`, the way the rows and the doctor name theirs. */
function madeByUs(dir) {
	const rel = relative(resolve(tmpdir()), resolve(dir));
	return !rel.startsWith("..") && !isAbsolute(rel) && rel.startsWith("pl-");
}
const refuse = (what) => {
	throw new Error(`${what}; markers go only in a scratch home`);
};

/** The config roots this process made with `mkdtemp`; user markers go in no other folder. */
const homes = new Set();

/**
 * The env for one isolation row: the agent's config folder from `env`, copied (links followed,
 * so nothing in the copy points back) into a scratch home made now. The source is only read.
 */
export function scratchEnv(harness, env) {
	const key = ROOT_VAR[harness];
	const src = key ? env[key] : undefined;
	if (!key) return env;
	if (!src) refuse(`${harness}: ${key} is not set`);
	if (!madeByUs(src)) refuse(`${harness}: ${key} is not under the temp folder`);
	const home = mkdtempSync(join(tmpdir(), "pl-seed-"));
	homes.add(resolve(home));
	const dest = join(home, "config");
	if (existsSync(src))
		cpSync(src, dest, { recursive: true, dereference: true });
	else mkdirSync(dest);
	return { ...env, [key]: dest };
}

/** The agent's config folder from `env`; refused unless it is inside a home `scratchEnv` made. */
export function scratchRoot(harness, env) {
	const key = ROOT_VAR[harness];
	const dir = key ? env[key] : undefined;
	if (!dir) refuse(`${harness}: ${key} is not set`);
	const home = [...homes].find((h) => within(resolve(dir), h));
	if (!home) refuse(`${harness}: ${key} is not a scratch home this run made`);
	homeFs(home).mkdir(dir);
	return dir;
}

/**
 * Writes that stay in `root`. Before any write or mkdir, the path's nearest existing ancestor
 * must resolve inside it, and an existing file must be neither a link nor hard-linked.
 */
export function homeFs(root) {
	if (!homes.has(resolve(root)) && !madeByUs(root))
		refuse(`${root} is not under the temp folder`);
	const real = realpathSync.native(root);
	const check = (path) => {
		const abs = resolve(path);
		if (!within(abs, resolve(root))) refuse(`${abs} is outside ${root}`);
		let at = abs;
		for (;;) {
			let st;
			try {
				st = lstatSync(at);
			} catch {
				at = dirname(at);
				continue;
			}
			if (at === abs && (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)))
				refuse(`${abs} is a link`);
			if (!within(realpathSync.native(at), real))
				refuse(`${abs} resolves outside ${root}`);
			return abs;
		}
	};
	const fs = {
		mkdir: (dir) => {
			const abs = resolve(dir);
			// One level at a time, so a link made between levels is still caught.
			if (existsSync(abs)) return void check(abs);
			fs.mkdir(dirname(abs));
			mkdirSync(check(abs));
		},
		write: (path, text) => {
			fs.mkdir(dirname(path));
			writeFileSync(check(path), text);
		},
		append: (path, text) => {
			fs.mkdir(dirname(path));
			appendFileSync(check(path), text);
		},
		merge: (path, add) =>
			fs.write(
				path,
				JSON.stringify({ ...readJson(check(path)), ...add }, null, 2),
			),
	};
	return fs;
}

/** The user-scope markers, in the agent's own scratch home from `env`. */
export function seedUser(harness, env, markers) {
	if (!(harness in ROOT_VAR)) return;
	const root = scratchRoot(harness, env);
	const f = homeFs(root);
	const hook = (name) => ({
		hooks: [{ type: "command", command: shell(markers, name) }],
	});
	if (harness === "claude-code") {
		const dir = root;
		f.merge(join(dir, "settings.json"), {
			hooks: {
				SessionStart: [hook("user-hook")],
				UserPromptSubmit: [hook("user-prompt-hook")],
			},
		});
		f.merge(join(dir, ".claude.json"), {
			mcpServers: { "mk-user": marker(markers, "mcp-user", true) },
		});
	} else if (harness === "codex") {
		const home = root;
		const mkt = join(home, "mk-marketplace");
		const plugin = (root) => {
			f.mkdir(join(root, ".codex-plugin"));
			f.write(
				join(root, ".codex-plugin", "plugin.json"),
				JSON.stringify({
					name: "mk-plugin",
					version: "0.0.1",
					mcpServers: "./.mcp.json",
				}),
			);
			f.write(
				join(root, ".mcp.json"),
				JSON.stringify({
					mcpServers: { "mk-plugin-mcp": marker(markers, "mcp-plugin", true) },
				}),
			);
		};
		f.mkdir(join(mkt, ".agents", "plugins"));
		f.write(
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
		f.append(
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
		f.write(
			join(home, "hooks.json"),
			JSON.stringify({ hooks: { SessionStart: [hook("user-hook")] } }),
		);
	} else if (harness === "opencode") {
		const dir = join(root, "opencode");
		const m = marker(markers, "mcp-user", true);
		f.merge(join(dir, "opencode.json"), {
			mcp: {
				"mk-user": {
					type: "local",
					command: [m.command, ...m.args],
					enabled: true,
				},
			},
		});
		const write = `appendFileSync(${JSON.stringify(join(markers, "plugin"))}, "loaded\\n")`;
		f.mkdir(join(dir, "plugin"));
		// 1.x calls each exported function; 2.x takes one default definition.
		f.write(
			join(dir, "plugin", "mk1.js"),
			`import { appendFileSync } from "node:fs";\nexport const Mk = async () => { ${write}; return {}; };\n`,
		);
		f.write(
			join(dir, "plugin", "mk2.js"),
			`import { appendFileSync } from "node:fs";\nexport default { id: "mk", setup: async () => { ${write}; return {}; } };\n`,
		);
	} else if (harness === "gemini") {
		const path = join(root, ".gemini", "settings.json");
		f.merge(path, {
			mcpServers: { "mk-user": marker(markers, "mcp-user", true) },
			hooks: { SessionStart: [hook("user-hook")] },
		});
	}
}

/** The project-scope markers, in the session's own folder. */
export function seedProject(harness, cwd, env, markers) {
	const f = homeFs(cwd);
	const hook = (name) => ({
		hooks: [{ type: "command", command: shell(markers, name) }],
	});
	const server = marker(markers, "mcp-project", true);
	if (harness === "claude-code") {
		f.merge(join(cwd, ".mcp.json"), { mcpServers: { "mk-project": server } });
		f.merge(join(cwd, ".claude", "settings.json"), {
			hooks: { SessionStart: [hook("project-hook")] },
		});
	} else if (harness === "codex") {
		f.mkdir(join(cwd, ".codex"));
		f.write(
			join(cwd, ".codex", "config.toml"),
			`[mcp_servers.mk-project]\ncommand = ${toml(server.command)}\nargs = [${server.args.map(toml).join(", ")}]\n`,
		);
		f.write(
			join(cwd, ".codex", "hooks.json"),
			JSON.stringify({ hooks: { SessionStart: [hook("project-hook")] } }),
		);
		homeFs(scratchRoot(harness, env)).append(
			join(scratchRoot(harness, env), "config.toml"),
			`\n[projects.${toml(cwd)}]\ntrust_level = "trusted"\n`,
		);
	} else if (harness === "opencode") {
		f.merge(join(cwd, "opencode.json"), {
			mcp: {
				"mk-project": {
					type: "local",
					command: [server.command, ...server.args],
					enabled: true,
				},
			},
		});
	} else if (harness === "gemini") {
		f.merge(join(cwd, ".gemini", "settings.json"), {
			mcpServers: { "mk-project": server },
			hooks: { SessionStart: [hook("project-hook")] },
		});
	}
}
