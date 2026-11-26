// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What an agent's own config files hold on disk, per its provider's `configLayout` (#1180 §3.1).
 * Never returns a command, argument, URL, env or header value: names, paths and transports only.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
	type ConfigLayout,
	HARNESS_REGISTRY,
	type HarnessId,
	type LayoutKey,
	type LayoutPath,
} from "@prismalens/config/harness";
import type { LoadedItem } from "@prismalens/contracts/schemas";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

/** The file system the reader looks at; tests swap it. */
export interface ConfigFs {
	/** A file's text, null when it is missing or unreadable. */
	text: (path: string) => string | null;
	/** A folder's child folder names, null when it is not a folder. */
	dirs: (path: string) => string[] | null;
}

export const nodeConfigFs: ConfigFs = {
	text: (path) => {
		try {
			return statSync(path).isFile() ? readFileSync(path, "utf8") : null;
		} catch {
			return null;
		}
	},
	dirs: (path) => {
		try {
			return readdirSync(path, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name);
		} catch {
			return null;
		}
	},
};

const MAX_ITEMS = 500;

type Env = Readonly<Record<string, string | undefined>>;

export function layoutOf(agent: string): ConfigLayout | null {
	return HARNESS_REGISTRY[agent as HarnessId]?.configLayout ?? null;
}

function homeOf(env: Env): string {
	return env.HOME || env.USERPROFILE || homedir();
}

/** Each folder from the project root up to, not including, home; only the root when it is outside home. */
function ancestors(repoRoot: string, home: string): string[] {
	const root = resolve(repoRoot);
	const top = resolve(home).toLowerCase();
	if (!root.toLowerCase().startsWith(top + sep)) return [root];
	const out: string[] = [];
	for (let dir = root; dir.toLowerCase() !== top; dir = dirname(dir)) {
		out.push(dir);
		if (dirname(dir) === dir) break;
	}
	return out;
}

/** `pattern` resolved to absolute paths, one per ancestor; empty when it needs a project and there is none. */
function expand(
	pattern: string,
	env: Env,
	repoRoot: string | null,
	ancestor?: string,
): string[] {
	const home = homeOf(env);
	let p = pattern.replace(
		/\{\$([A-Z0-9_]+)\|([^}]*)\}/g,
		(_, name: string, fallback: string) => env[name] || fallback,
	);
	if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
	if (p.includes("<repo>")) {
		if (!repoRoot) return [];
		p = p.replaceAll("<repo>", repoRoot);
	}
	if (p.includes("<ancestors>")) {
		if (!repoRoot) return [];
		const dirs = ancestor ? [ancestor] : ancestors(repoRoot, home);
		return dirs.map((d) => resolve(p.replaceAll("<ancestors>", d)));
	}
	return [resolve(p)];
}

/** Each path a layout entry names, with the ancestor it came from. */
function pathsOf(
	entry: LayoutPath,
	env: Env,
	repoRoot: string | null,
): { path: string; ancestor?: string }[] {
	if (!entry.path.includes("<ancestors>") || !repoRoot)
		return expand(entry.path, env, repoRoot).map((path) => ({ path }));
	return ancestors(repoRoot, homeOf(env)).flatMap((a) =>
		expand(entry.path, env, repoRoot, a).map((path) => ({
			path,
			ancestor: a,
		})),
	);
}

function skipped(
	entry: LayoutPath,
	ancestor: string | undefined,
	env: Env,
	repoRoot: string | null,
	fs: ConfigFs,
): boolean {
	if (!entry.onlyIfMissing) return false;
	return expand(entry.onlyIfMissing, env, repoRoot, ancestor).some(
		(p) => fs.text(p) !== null,
	);
}

function parse(
	text: string,
	format: LayoutKey["format"],
): Record<string, unknown> | null {
	try {
		if (format === "toml") return parseToml(text) as Record<string, unknown>;
		const errors: ParseError[] = [];
		const v: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
		if (format === "json" && errors.length) return null;
		return v && typeof v === "object" && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** The value at a dot path; `<repo>` is one segment, tried as given and with `/` separators. */
function at(
	obj: Record<string, unknown>,
	key: string,
	repoRoot: string | null,
): unknown {
	let cur: unknown = obj;
	for (const seg of key.split(".")) {
		if (!cur || typeof cur !== "object") return undefined;
		const rec = cur as Record<string, unknown>;
		if (seg === "<repo>") {
			if (!repoRoot) return undefined;
			cur = rec[repoRoot] ?? rec[repoRoot.replaceAll("\\", "/")];
		} else cur = rec[seg];
	}
	return cur;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);

function transportOf(def: unknown): LoadedItem["transport"] {
	if (!isRecord(def)) return undefined;
	const type = typeof def.type === "string" ? def.type : "";
	if (type === "sse") return "sse";
	if (/http|remote/.test(type) || "url" in def || "httpUrl" in def)
		return "http";
	if (type === "stdio" || type === "local" || "command" in def) return "stdio";
	return undefined;
}

const isOff = (def: unknown): boolean =>
	isRecord(def) && (def.enabled === false || def.disabled === true);

function item(
	entry: LayoutPath,
	kind: LoadedItem["kind"],
	name: string,
	path: string,
	state: LoadedItem["state"],
	extra: Partial<LoadedItem> = {},
): LoadedItem {
	return {
		kind,
		name: name || "(unnamed)",
		scope: entry.scope,
		path,
		disk: true,
		reported: null,
		state,
		...(entry.via ? { via: entry.via } : {}),
		...extra,
	};
}

/** On disk, repo-scope hooks and MCP servers load as the agent loads them (§2 R2). */
const foundState = (entry: LayoutPath): LoadedItem["state"] =>
	entry.scope === "repo" ? "in-project" : "found";

function keyed(
	entry: LayoutKey,
	kind: "mcp" | "hook" | "plugin",
	env: Env,
	repoRoot: string | null,
	fs: ConfigFs,
): LoadedItem[] {
	const out: LoadedItem[] = [];
	for (const { path, ancestor } of pathsOf(entry, env, repoRoot)) {
		if (skipped(entry, ancestor, env, repoRoot, fs)) continue;
		const text = fs.text(path);
		if (text === null) continue;
		const config = parse(text, entry.format);
		if (!config) {
			out.push(item(entry, kind, basename(path), path, "failed"));
			continue;
		}
		const value = at(config, entry.key, repoRoot);
		if (Array.isArray(value)) {
			for (const v of value)
				if (typeof v === "string")
					out.push(item(entry, kind, v, path, foundState(entry)));
			continue;
		}
		if (!isRecord(value)) continue;
		for (const [name, def] of Object.entries(value)) {
			const off = kind === "plugin" ? def === false : isOff(def);
			const transport = kind === "mcp" ? transportOf(def) : undefined;
			out.push(
				item(
					entry,
					kind,
					name,
					path,
					off ? "off" : kind === "plugin" ? "found" : foundState(entry),
					transport ? { transport } : {},
				),
			);
		}
	}
	return out;
}

/** Everything the agent's own config holds on disk now, bounded for display; an agent with no layout has none. */
export function readOnDisk(
	agent: string,
	env: Env,
	repoRoot: string | null,
	fs: ConfigFs = nodeConfigFs,
	layout: ConfigLayout | null = layoutOf(agent),
): LoadedItem[] {
	return allOnDisk(agent, env, repoRoot, fs, layout)
		.slice(0, MAX_ITEMS)
		.map((i) => ({ ...i, name: i.name.slice(0, 200) }));
}

/** Every item with its whole name and no count limit: what isolation and the reserved name read. */
export function allOnDisk(
	agent: string,
	env: Env,
	repoRoot: string | null,
	fs: ConfigFs = nodeConfigFs,
	layout: ConfigLayout | null = layoutOf(agent),
): LoadedItem[] {
	if (!layout) return [];
	const out: LoadedItem[] = [];
	for (const entry of layout.instructions)
		for (const { path, ancestor } of pathsOf(entry, env, repoRoot))
			if (
				fs.text(path) !== null &&
				!skipped(entry, ancestor, env, repoRoot, fs)
			)
				out.push(item(entry, "instructions", basename(path), path, "found"));
	for (const entry of layout.skills)
		for (const { path, ancestor } of pathsOf(entry, env, repoRoot)) {
			if (skipped(entry, ancestor, env, repoRoot, fs)) continue;
			for (const child of fs.dirs(path) ?? [])
				if (fs.text(join(path, child, "SKILL.md")) !== null)
					out.push(item(entry, "skill", child, join(path, child), "found"));
		}
	for (const entry of layout.mcp)
		out.push(...keyed(entry, "mcp", env, repoRoot, fs));
	for (const entry of layout.hooks)
		out.push(...keyed(entry, "hook", env, repoRoot, fs));
	for (const entry of layout.plugins) {
		if ("key" in entry) {
			out.push(...keyed(entry, "plugin", env, repoRoot, fs));
			continue;
		}
		for (const { path } of pathsOf(entry, env, repoRoot))
			for (const child of fs.dirs(path) ?? [])
				out.push(item(entry, "plugin", child, join(path, child), "found"));
	}
	const seen = new Set<string>();
	return out.filter((i) => {
		const k = `${i.kind}\0${i.name}\0${i.scope}\0${i.path}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/**
 * The MCP server names in the agent's own and the project's config, the shape an isolation's
 * `mcp` input takes (each is turned off by name). `except`: names this launch sends itself.
 */
export function foundMcpNames(
	agent: string,
	env: Env,
	repoRoot: string | null,
	fs: ConfigFs = nodeConfigFs,
	except: readonly string[] = [],
): string[] {
	return [
		...new Set(
			allOnDisk(agent, env, repoRoot, fs)
				.filter(
					(i) =>
						i.kind === "mcp" &&
						i.state !== "failed" &&
						!except.includes(i.name),
				)
				.map((i) => i.name),
		),
	];
}

/** What a session's launch policy adds to its fingerprint. */
export interface LoadoutPolicy {
	profile: "own" | "clean";
	/** Which `probeIsolation` or `cleanProfile` applied, or null. */
	isolation: string | null;
	/** The PrismaLens set's revision, and whether this agent receives it. */
	sharedRevision: string;
	member: boolean;
}

/**
 * A hash over the sorted on-disk items with each source file's content, the shared set's
 * revision and membership, and the launch policy. A view merges a session's report only when
 * its fingerprint equals the view's own (§3.1).
 */
export function configFingerprint(
	agent: string,
	env: Env,
	repoRoot: string | null,
	policy: LoadoutPolicy,
	fs: ConfigFs = nodeConfigFs,
): string {
	const items = readOnDisk(agent, env, repoRoot, fs);
	const content = (path: string | null) => {
		if (!path) return "";
		const text = fs.text(path) ?? fs.text(join(path, "SKILL.md")) ?? "";
		return createHash("sha256").update(text).digest("hex");
	};
	const rows = items
		.map((i) =>
			[i.kind, i.name, i.scope, i.path ?? "", i.state, content(i.path)].join(
				"\0",
			),
		)
		.sort();
	return createHash("sha256")
		.update(JSON.stringify({ agent, rows, policy }))
		.digest("hex");
}

/** A user-scope MCP server as a share form starts from it; values are never read (§3.3). */
export interface McpSource {
	transport: "stdio" | "http";
	command: string | null;
	args: string[];
	url: string | null;
	/** Env and header names only. */
	env: string[];
	headers: string[];
}

const strings = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const names = (v: unknown): string[] =>
	isRecord(v)
		? Object.keys(v)
		: Array.isArray(v)
			? v.flatMap((x) =>
					isRecord(x) && typeof x.name === "string" ? [x.name] : [],
				)
			: [];

/** One global MCP server of `agent`'s own config at `path`, normalized across the four formats. */
export function readMcpSource(
	agent: string,
	env: Env,
	path: string,
	name: string,
	fs: ConfigFs = nodeConfigFs,
): McpSource | null {
	const layout = layoutOf(agent);
	for (const entry of layout?.mcp ?? []) {
		if (entry.scope !== "global") continue;
		const [resolved] = expand(entry.path, env, null);
		if (!resolved || resolve(path) !== resolved) continue;
		const text = fs.text(resolved);
		const config = text === null ? null : parse(text, entry.format);
		const value = config ? at(config, entry.key, null) : undefined;
		const def = isRecord(value) ? value[name] : undefined;
		if (!isRecord(def)) return null;
		const url =
			typeof def.url === "string"
				? def.url
				: typeof def.httpUrl === "string"
					? def.httpUrl
					: null;
		if (url)
			return {
				transport: "http",
				command: null,
				args: [],
				url,
				env: [],
				headers: [...names(def.headers), ...names(def.http_headers)],
			};
		// OpenCode keeps the command and its arguments in one array.
		const cmd = Array.isArray(def.command) ? strings(def.command) : null;
		return {
			transport: "stdio",
			command: cmd
				? (cmd[0] ?? null)
				: typeof def.command === "string"
					? def.command
					: null,
			args: cmd ? cmd.slice(1) : strings(def.args),
			url: null,
			env: [...names(def.env), ...names(def.environment)],
			headers: [],
		};
	}
	return null;
}

/** sha256 of a source entry as it stands, for `Changed in <agent>`. */
export function mcpSourceHash(source: McpSource | null): string {
	return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}
