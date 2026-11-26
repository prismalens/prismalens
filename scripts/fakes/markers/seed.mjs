// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Seeds the isolation rows' markers (#1180) into each agent's own config files: a hook, a user and
// a project MCP server, and Codex and OpenCode plugins. Each agent keeps them in its own layout.
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmdirSync,
	rmSync,
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
/** Every folder an agent here reads its setup from or keeps its state in, set or not. */
const ROOT_KEYS = [
	...new Set([
		...Object.values(ROOT_VAR),
		"XDG_DATA_HOME",
		"XDG_CACHE_HOME",
		"XDG_STATE_HOME",
		"HOME",
		"USERPROFILE",
	]),
];
export const rootKeys = () => [...ROOT_KEYS];

const within = (path, root) => {
	const rel = relative(root, path);
	return !rel.startsWith("..") && !isAbsolute(rel);
};
/** `<temp>/pl-*`, by the path as written and, once it exists, by its real path. */
function madeByUs(dir) {
	const under = (path, temp) => {
		const rel = relative(temp, path);
		return rel.startsWith("pl-") && !isAbsolute(rel);
	};
	if (!isAbsolute(dir) || !under(resolve(dir), resolve(tmpdir()))) return false;
	return (
		!existsSync(dir) ||
		under(realpathSync.native(dir), realpathSync.native(tmpdir()))
	);
}
const refuse = (what) => {
	throw new Error(`${what}; markers go only in a scratch home`);
};
const there = (path) => {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
};

/** Is `err` a file that vanished, as an agent's per-process temp entries do while it runs. */
const gone = (err) =>
	err instanceof Error && "code" in err && err.code === "ENOENT";
/**
 * Copies regular files and folders from `src` into `dest`, never through a link. An entry that
 * vanishes mid-copy is skipped: rows before this one leave agents running in the same folder.
 */
function copyConfig(src, dest) {
	let names = [];
	try {
		names = readdirSync(src);
	} catch (err) {
		if (!gone(err)) throw err;
	}
	for (const name of names) {
		const from = join(src, name);
		const to = join(dest, name);
		try {
			const st = lstatSync(from);
			if (st.isDirectory()) {
				mkdirSync(to, { recursive: true });
				copyConfig(from, to);
			} else if (st.isFile()) copyFileSync(from, to);
		} catch (err) {
			if (!gone(err)) throw err;
		}
	}
}

/** The homes this process made with `mkdtemp`; user markers go in no other folder. */
const homes = new Set();

/**
 * The env for one isolation row: every root in `ROOT_KEYS` is a folder made now in a new home, so
 * no agent falls back to the real home. The agent's own config folder, when given, is copied in
 * (`copyConfig`); the source is only read.
 */
export function scratchEnv(harness, env) {
	const key = ROOT_VAR[harness];
	if (!key) return env;
	const src = env[key];
	if (src !== undefined && !madeByUs(src))
		refuse(`${harness}: ${key} is not under the temp folder`);
	const home = mkdtempSync(join(realpathSync.native(tmpdir()), "pl-seed-"));
	homes.add(home);
	const out = { ...env };
	for (const k of ROOT_KEYS) {
		out[k] = join(home, k.toLowerCase());
		mkdirSync(out[k], { recursive: true });
	}
	if (src !== undefined) copyConfig(src, out[key]);
	return out;
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

let seq = 0;
/**
 * Writes that stay in `root`. Each folder is made one level at a time and checked again once made
 * (removed if it landed outside); a file is written to a fresh name and renamed over its target, so
 * a link put there is replaced, not followed. `between` runs after a check, before the create.
 */
export function homeFs(root, { between } = {}) {
	if (!homes.has(resolve(root)) && !madeByUs(root))
		refuse(`${root} is not under the temp folder`);
	const real = realpathSync.native(root);
	const check = (path) => {
		const abs = resolve(path);
		if (!within(abs, resolve(root))) refuse(`${abs} is outside ${root}`);
		let at = abs;
		while (!there(at)) at = dirname(at);
		const st = lstatSync(at);
		if (at === abs && (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)))
			refuse(`${abs} is a link`);
		if (!within(realpathSync.native(at), real))
			refuse(`${abs} resolves outside ${root}`);
		return abs;
	};
	const put = (path, text) => {
		fs.mkdir(dirname(path));
		const abs = check(path);
		between?.(abs);
		const fresh = join(dirname(abs), `.pl-seed-${process.pid}-${++seq}`);
		writeFileSync(fresh, text, { flag: "wx" });
		try {
			check(fresh);
			renameSync(fresh, abs);
		} catch (err) {
			rmSync(fresh, { force: true });
			throw err;
		}
	};
	const fs = {
		mkdir: (dir) => {
			const abs = resolve(dir);
			if (there(abs)) return void check(abs);
			fs.mkdir(dirname(abs));
			check(abs);
			between?.(abs);
			mkdirSync(abs);
			try {
				check(abs);
			} catch (err) {
				rmdirSync(abs);
				throw err;
			}
		},
		write: put,
		append: (path, text) =>
			put(path, (there(path) ? readFileSync(check(path), "utf8") : "") + text),
		merge: (path, add) =>
			put(path, JSON.stringify({ ...readJson(check(path)), ...add }, null, 2)),
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
