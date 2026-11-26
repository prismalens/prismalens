// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The PrismaLens set's MCP servers as one session receives them (#1180 §3.3): a snapshot the
 * person approved, bound to its files' hashes and its values, sent as `pl-<name>` to each
 * recipient. Every file is hashed again at each session open, with no cache.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, isAbsolute, join, parse, resolve } from "node:path";
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
		readonly code:
			| "relative-path"
			| "too-large"
			| "not-found"
			| "unreadable"
			| "value-path",
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
	for (const [i, a] of def.args.entries()) {
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
				`Argument ${i + 1} holds a secret that looks like a path; move it to an environment variable`,
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
	hash: (path: string) => Promise<string | null> = hashFile,
): Promise<{ def: SharedMcpDef; files: SharedMcpServerStored["files"] }> {
	if (def.type !== "stdio") return { def, files: [] };
	const named = def.args.flatMap((a) => {
		const file = typeof a === "string" ? fileArg(a) : null;
		return file ? [file] : [];
	});
	const command = resolveCommand(def.command, env);
	if (!command) throw new ShareRefused("not-found", "Command not found");
	// The command must hash: delivery checks only stored digests, so an unhashed one is never checked.
	let digest: string | null;
	try {
		digest = await hash(command);
	} catch (err) {
		if (err instanceof ShareRefused) throw err;
		throw new ShareRefused("unreadable", "Command could not be read");
	}
	if (!digest) throw new ShareRefused("not-found", "Command not found");
	const files: SharedMcpServerStored["files"] = [
		{ path: command, sha256: digest },
	];
	for (const path of new Set(named.filter((p) => p !== command))) {
		const sha256 = await hash(path);
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
	| "Changed"
	| "Needs an absolute script path"
	| "Not supported for deepagents";

export interface SharedDelivery {
	/** For ACP `mcpServers` on `session/new`, `session/load` and `session/resume` alike. */
	servers: McpServer[];
	/** One row per shared server for What loads. */
	items: LoadedItem[];
	/** Every value sent, for the scrubbers. */
	hidden: string[];
}

/** The arguments `toMcp` sends: the definition's, with each value put in. */
function argvOf(s: SharedMcpServerStored): string[] {
	if (s.def.type !== "stdio") return [];
	return s.def.args.map((a) =>
		typeof a === "string" ? a : (s.values[a.value] ?? ""),
	);
}

/** Node options that take the next argument as their value (nodejs.org/api/cli.html). */
const NODE_VALUE_FLAGS = new Set([
	"-r",
	"--require",
	"--import",
	"--loader",
	"--experimental-loader",
	"-C",
	"--conditions",
	"--input-type",
	"--title",
	"--env-file",
	"--watch-path",
	"--inspect-port",
	"--disable-warning",
	"--redirect-warnings",
]);
/** Options after which Node runs no script file: code given inline, stdin, or a package.json script. */
const NODE_NO_SCRIPT =
	/^(?:-[a-zA-Z]*[ep][a-zA-Z]*|--eval|--print|--run|-)(?:=|$)/;

/** The script Node loads from `argv`: the first argument after Node's own options; null for none. */
export function nodeEntry(argv: readonly string[]): string | null {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		if (a === "--") return argv[i + 1] ?? null;
		if (NODE_NO_SCRIPT.test(a)) return null;
		if (!a.startsWith("-")) return a;
		if (!a.includes("=") && NODE_VALUE_FLAGS.has(a)) i++;
	}
	return null;
}

/**
 * Whether a `node` server's entry script is one Node would load relative to `cwd`, each thread's
 * own folder. Approval has no folder, so it hashed no such file.
 */
function relativeScript(s: SharedMcpServerStored, cwd: string): boolean {
	if (
		s.def.type !== "stdio" ||
		parse(s.def.command).name.toLowerCase() !== "node"
	)
		return false;
	const entry = nodeEntry(argvOf(s));
	if (!entry || isAbsolute(entry)) return false;
	try {
		createRequire(join(cwd, "noop.js")).resolve(`./${entry}`);
		return true;
	} catch {
		return false;
	}
}

function toMcp(s: SharedMcpServerStored): McpServer {
	const name = sharedServerName(s.name);
	const v = (n: string) => s.values[n] ?? "";
	if (s.def.type === "stdio")
		return {
			name,
			command: s.def.command,
			args: argvOf(s),
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
		/** Whether the session takes HTTP servers; `unknown` before it opens, as Settings sees it. */
		http: boolean | "unknown";
		ownNames: readonly string[];
		/** deepagents reads servers from its run file, which never holds a value. */
		runFile?: boolean;
		/** The folder the session starts in; a node script relative to it is not sent. */
		cwd?: string | null;
		hash?: (path: string) => Promise<string | null>;
	},
): Promise<SharedDelivery> {
	const hash = o.hash ?? ((p: string) => hashFile(p).catch(() => null));
	const out: SharedDelivery = { servers: [], items: [], hidden: [] };
	for (const s of stored) {
		const name = sharedServerName(s.name);
		const transport = s.def.type;
		// An HTTP server goes to a session only if it takes HTTP; before one opens that is unknown.
		const maybe = transport === "http" && o.http === "unknown";
		const row = (note: NotSent | null): LoadedItem => ({
			kind: "mcp",
			name,
			scope: "prismalens",
			path: null,
			disk: false,
			reported: null,
			state: note ? "not-sent" : maybe ? "unknown" : "loads",
			transport,
			layer: "config",
			...(note
				? { note }
				: maybe
					? { note: "Sent if the agent takes HTTP" }
					: {}),
		});
		const names = valueNamesOf(s.def);
		let note: NotSent | null = null;
		if (!s.recipients.includes(agent)) note = "Not a recipient";
		else if (s.valuesFor !== s.hash || names.some((n) => !(n in s.values)))
			note = "Not sent: needs values";
		else if (transport === "http" && o.http === false)
			note = "Not sent: no HTTP";
		else if (o.ownNames.includes(name)) note = "Not sent: name taken";
		else if (o.runFile && names.length) note = "Not supported for deepagents";
		else if (o.cwd && relativeScript(s, o.cwd))
			note = "Needs an absolute script path";
		else
			for (const f of s.files)
				if ((await hash(f.path)) !== f.sha256) {
					note = "Changed";
					break;
				}
		out.items.push(row(note));
		if (note) continue;
		out.servers.push(toMcp(s));
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
	/** The instructions revision recorded on `session_opened`. */
	revision: string;
	/** Null when the agent is not a recipient or there is no text. */
	instructions: string | null;
	/** `configFingerprint` for this session's `agent_loadout` report. */
	fingerprint: string;
	profile: "own" | "clean";
}
