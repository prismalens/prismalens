// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The PrismaLens set's MCP servers as one session receives them (#1180 §3.3): a snapshot the
 * person approved, bound to its files' hashes and its values, sent as `pl-<name>` to each
 * recipient. Every file is hashed again at each session open, with no cache.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
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
		readonly code: "relative-path" | "too-large" | "not-found",
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
			const p = join(dir, command + ext);
			if (isFile(p)) return p;
		}
	return null;
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
	for (const a of def.args)
		if (typeof a === "string" && /^\.\.?[\\/]/.test(a))
			throw new ShareRefused("relative-path", "Uses a relative path");
	const command = resolveCommand(def.command, env);
	if (!command) throw new ShareRefused("not-found", "Command not found");
	const paths = [
		command,
		...def.args.filter(
			(a): a is string => typeof a === "string" && isAbsolute(a),
		),
	];
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
	| "Changed"
	| "Not supported for deepagents";

export interface SharedDelivery {
	/** For ACP `mcpServers` on `session/new`, `session/load` and `session/resume` alike. */
	servers: McpServer[];
	/** One row per shared server for What loads. */
	items: LoadedItem[];
	/** Every value sent, for the scrubbers. */
	hidden: string[];
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
		/** deepagents reads servers from its run file, which never holds a value. */
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
		else if (o.runFile && names.length) note = "Not supported for deepagents";
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
