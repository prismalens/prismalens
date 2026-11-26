// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The PrismaLens set's MCP servers as one session receives them (#1180 §3.3): a snapshot the
 * person approved, bound to its files' hashes and its values, sent as `pl-<name>` to each
 * recipient. Every file is hashed again at each session open, with no cache.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk/unstable";
import type {
	LoadedItem,
	SharedMcpDef,
	SharedMcpServerStored,
} from "@prismalens/contracts/schemas";

/** Files over this are refused at share: `Too large to check`. */
export const MAX_HASHED_FILE = 64 * 1024 * 1024;

export const sharedServerName = (name: string) => `pl-${name}`;

export class ShareRefused extends Error {
	constructor(
		readonly code: "relative-path" | "too-large" | "not-found" | "value-path",
		message: string,
	) {
		super(message);
		this.name = "ShareRefused";
	}
}

/** sha256 of a file, or null when it is missing; throws `too-large` past the limit. */
export async function hashFile(path: string): Promise<string | null> {
	let size: number;
	try {
		const st = statSync(path);
		if (!st.isFile()) return null;
		size = st.size;
	} catch {
		return null;
	}
	if (size > MAX_HASHED_FILE)
		throw new ShareRefused("too-large", "Too large to check");
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

/** `command` as an absolute path through the agent's planned `PATH`; null when not found. */
export function resolveCommand(
	command: string,
	env: Readonly<Record<string, string | undefined>>,
	platform: string = process.platform,
): string | null {
	const isFile = (p: string) => {
		try {
			return statSync(p).isFile();
		} catch {
			return false;
		}
	};
	if (isAbsolute(command)) return isFile(command) ? command : null;
	if (/[\\/]/.test(command))
		throw new ShareRefused("relative-path", "Uses a relative path");
	const path = env.PATH ?? env.Path ?? "";
	const exts =
		platform === "win32"
			? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")]
			: [""];
	for (const dir of path.split(delimiter).filter(Boolean))
		for (const ext of exts) {
			const p = resolve(dir, command + ext);
			if (isFile(p)) return p;
		}
	return null;
}

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const FILE_EXT = /\.(?:[cm]?[jt]s|py|rb|sh|ps1|bat|cmd|jar|json|toml|ya?ml)$/i;

/**
 * The absolute file a stdio argument names (the whole argument, or a flag's value after `=`), else
 * null. One naming a file relative to the folder the server starts in, each thread's own, is
 * refused; a scoped package name such as `@scope/pkg` names no file.
 */
export function fileArg(arg: string): string | null {
	const value = /^--?[^=]+=/.test(arg) ? arg.slice(arg.indexOf("=") + 1) : arg;
	if (!value || value.startsWith("@") || URL_LIKE.test(value)) return null;
	if (isAbsolute(value)) return value;
	if (/^~|[\\/]/.test(value) || FILE_EXT.test(value) || /^\.\.?$/.test(value))
		throw new ShareRefused("relative-path", "Uses a relative path");
	return null;
}

/** Refuses a value that fills a stdio argument and names a file by `fileArg`: approval binds only the definition's own files. */
export function refuseValueFiles(
	def: SharedMcpDef,
	values: Readonly<Record<string, string>>,
): void {
	if (def.type !== "stdio") return;
	for (const a of def.args) {
		const v = typeof a === "string" ? undefined : values[a.value];
		let file = false;
		try {
			file = v !== undefined && fileArg(v) !== null;
		} catch {
			file = true;
		}
		if (file)
			throw new ShareRefused(
				"value-path",
				"A value names a file; put a path in the definition and a token in env",
			);
	}
}

/** The value names a definition reads: env, header, argument and query names. */
export function valueNamesOf(def: SharedMcpDef): string[] {
	if (def.type === "stdio")
		return [
			...new Set([
				...def.env,
				...def.args.flatMap((a) => (typeof a === "string" ? [] : [a.value])),
			]),
		];
	return [...new Set([...def.headers, ...def.query])];
}

/** The hash approval binds values to: the definition, its files' hashes and its value names. */
export function sharedServerHash(
	def: SharedMcpDef,
	files: SharedMcpServerStored["files"],
): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				def,
				files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
				values: valueNamesOf(def).sort(),
			}),
		)
		.digest("hex");
}

/**
 * What a stdio definition binds at share: the command resolved to an absolute path, and the
 * sha256 of it and of every argument that is an absolute path to an existing file.
 */
export async function bindFiles(
	def: SharedMcpDef,
	env: Readonly<Record<string, string | undefined>>,
): Promise<{ def: SharedMcpDef; files: SharedMcpServerStored["files"] }> {
	if (def.type !== "stdio") return { def, files: [] };
	const named = def.args.flatMap((a) => {
		const file = typeof a === "string" ? fileArg(a) : null;
		return file ? [file] : [];
	});
	const command = resolveCommand(def.command, env);
	if (!command) throw new ShareRefused("not-found", "Command not found");
	const paths = [command, ...named];
	const files: SharedMcpServerStored["files"] = [];
	for (const path of new Set(paths)) {
		const sha256 = await hashFile(path);
		if (sha256) files.push({ path, sha256 });
	}
	return { def: { ...def, command }, files };
}

/** Why a shared server is not sent to this agent now, as What loads says it; null when it is sent. */
export type NotSent =
	| "Not a recipient"
	| "Not sent: needs values"
	| "Not sent: no HTTP"
	| "Not sent: name taken"
	| "Changed";

export interface SharedDelivery {
	/** For ACP `mcpServers` on `session/new`, `session/load` and `session/resume` alike. */
	servers: McpServer[];
	/** One row per shared server for What loads. */
	items: LoadedItem[];
	/** Every value sent, for the scrubbers. */
	hidden: string[];
	/** With `runFile`: the servers for the agent's run file, and the env its references read. */
	runFile?: RunFileServers;
}

/** Servers as a run file holds them, each value a `${PL_SV_<server>_<n>}` the child's env answers. */
export interface RunFileServers {
	servers: Record<string, Record<string, unknown>>;
	env: Record<string, string>;
}

/** `s` for a run file: every value an env reference, so the file never holds one (#1180 §3.3). */
export function toRunFile(s: SharedMcpServerStored): RunFileServers {
	const env: Record<string, string> = {};
	const prefix = `PL_SV_${s.name.toUpperCase().replaceAll("-", "_")}`;
	const ref = (n: string) => {
		const key = `${prefix}_${Object.keys(env).length + 1}`;
		env[key] = s.values[n] ?? "";
		return `\${${key}}`;
	};
	const pairs = (names: readonly string[]) =>
		Object.fromEntries(names.map((n) => [n, ref(n)]));
	const name = sharedServerName(s.name);
	if (s.def.type === "stdio")
		return {
			servers: {
				[name]: {
					command: s.def.command,
					args: s.def.args.map((a) =>
						typeof a === "string" ? a : ref(a.value),
					),
					env: pairs(s.def.env),
				},
			},
			env,
		};
	// The reference stays unencoded in the query, so dcode can expand it there.
	const base = new URL(s.def.url).toString();
	const query = s.def.query.map((q) => `${encodeURIComponent(q)}=${ref(q)}`);
	return {
		servers: {
			[name]: {
				type: "http",
				url: query.length
					? `${base}${base.includes("?") ? "&" : "?"}${query.join("&")}`
					: base,
				headers: pairs(s.def.headers),
			},
		},
		env,
	};
}

function toMcp(s: SharedMcpServerStored): McpServer {
	const name = sharedServerName(s.name);
	const v = (n: string) => s.values[n] ?? "";
	if (s.def.type === "stdio")
		return {
			name,
			command: s.def.command,
			args: s.def.args.map((a) => (typeof a === "string" ? a : v(a.value))),
			env: s.def.env.map((n) => ({ name: n, value: v(n) })),
		};
	const url = new URL(s.def.url);
	for (const q of s.def.query) url.searchParams.set(q, v(q));
	return {
		type: "http",
		name,
		url: url.toString(),
		headers: s.def.headers.map((n) => ({ name: n, value: v(n) })),
	};
}

/**
 * Which shared servers reach `agent` on this session open. `ownNames`: the MCP server names in
 * the agent's own config; one already named `pl-<name>` keeps the shared one from being sent.
 */
export async function deliverShared(
	stored: readonly SharedMcpServerStored[],
	agent: string,
	o: {
		http: boolean;
		ownNames: readonly string[];
		/** deepagents reads servers from its run file, which holds env references, never a value. */
		runFile?: boolean;
		hash?: (path: string) => Promise<string | null>;
	},
): Promise<SharedDelivery> {
	const hash = o.hash ?? ((p: string) => hashFile(p).catch(() => null));
	const out: SharedDelivery = { servers: [], items: [], hidden: [] };
	for (const s of stored) {
		const name = sharedServerName(s.name);
		const transport = s.def.type;
		const row = (note: NotSent | null): LoadedItem => ({
			kind: "mcp",
			name,
			scope: "prismalens",
			path: null,
			disk: false,
			reported: null,
			state: note ? "not-sent" : "loads",
			transport,
			layer: "config",
			...(note ? { note } : {}),
		});
		const names = valueNamesOf(s.def);
		let note: NotSent | null = null;
		if (!s.recipients.includes(agent)) note = "Not a recipient";
		else if (s.valuesFor !== s.hash || names.some((n) => !(n in s.values)))
			note = "Not sent: needs values";
		else if (transport === "http" && !o.http) note = "Not sent: no HTTP";
		else if (o.ownNames.includes(name)) note = "Not sent: name taken";
		else
			for (const f of s.files)
				if ((await hash(f.path)) !== f.sha256) {
					note = "Changed";
					break;
				}
		out.items.push(row(note));
		if (note) continue;
		if (o.runFile) {
			const file = toRunFile(s);
			out.runFile = {
				servers: { ...out.runFile?.servers, ...file.servers },
				env: { ...out.runFile?.env, ...file.env },
			};
		} else out.servers.push(toMcp(s));
		out.hidden.push(...names.map((n) => s.values[n] ?? "").filter(Boolean));
	}
	return out;
}

/** What one run's session gets of the PrismaLens set, resolved by the product before launch. */
export interface RunShared {
	/** For ACP `mcpServers`; `pick` drops HTTP ones where the agent takes none. */
	servers: McpServer[];
	/** Every value sent, for the scrubbers. */
	hidden: string[];
	/** The servers for an agent that reads them from its run file (deepagents). */
	runFile?: RunFileServers;
	/** The set's instructions revision now. */
	revision: string;
	/** The revision the thread's session holds (`heldSharedRevision`), for a reopen. */
	held?: string | null;
	/** Null when the agent is not a recipient or there is no text. */
	instructions: string | null;
	/** `configFingerprint` for this session's `agent_loadout` report. */
	fingerprint: string;
	profile: "own" | "clean";
}
