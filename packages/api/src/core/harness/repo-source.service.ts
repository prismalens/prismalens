// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A service names its code as a local folder or a git URL. Every run gets a
 * fresh snapshot of the committed HEAD under the app-data dir, so the harness
 * cwd is never the user's checkout and never a worktree linked into it
 * (ADR 0004 §2, #629). A URL is kept as a bare mirror and refreshed before each
 * snapshot with the user's own git; a stored connection token rides as a
 * per-command header, never in the URL or the mirror's config.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";

const run = promisify(execFile);
/** A remote that accepts the connection and then stalls must not hang a save or a run. */
const GIT_TIMEOUT_MS = 10 * 60_000;

export type RepoSourceKind = "folder" | "url";

export interface RepoSource {
	kind: RepoSourceKind;
	/** An absolute folder path, or a git URL (https, ssh, scp-style). */
	source: string;
	defaultBranch?: string | null;
	/** Token of the VCS connection that discovered the repo, when one exists. HTTPS only. */
	token?: string | null;
}

export interface SourceCheck {
	branch: string | null;
	head: string;
}

export interface FolderCheck extends SourceCheck {
	/** The repository's top level, which is what a snapshot clones. */
	root: string;
	/** Where the given folder sits inside it, "" at the top. */
	prefix: string;
}

export interface Snapshot {
	path: string;
	head: string;
	branch: string | null;
}

/** Paths a supported harness loads as its own config, hooks or plugins when found in a repo. */
const AGENT_CONFIG_NAMES = new Set([
	".opencode",
	"opencode.json",
	"opencode.jsonc",
	".claude",
	".mcp.json",
	".gemini",
	".codex",
]);

const URL_LIKE = /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/;

/** Folder or URL; anything else is refused before git sees it. */
export function classifySource(input: string): {
	kind: RepoSourceKind;
	source: string;
} {
	const trimmed = input.trim();
	// A leading dash would reach git as an option: `-uCMD@host:x` passes the URL test.
	if (trimmed.startsWith("-"))
		throw new Error("Repository must not start with '-'");
	const expanded = trimmed.startsWith("~/")
		? join(homedir(), trimmed.slice(2))
		: trimmed;
	if (isAbsolute(expanded))
		return { kind: "folder", source: resolve(expanded) };
	if (URL_LIKE.test(trimmed)) {
		if (hasEmbeddedSecret(trimmed))
			throw new Error(
				"Repository URL must not carry credentials; connect the VCS integration instead",
			);
		return { kind: "url", source: trimmed };
	}
	throw new Error(
		"Repository must be an absolute folder path or a git URL (https://, ssh://, git@host:owner/repo)",
	);
}

/** "owner/repo" for a URL, the folder name for a path. */
export function displayNameFor(kind: RepoSourceKind, source: string): string {
	if (kind === "folder") return basename(source);
	const segments = urlSegments(source);
	return segments.slice(-2).join("/") || source;
}

export function mirrorPathFor(
	url: string,
	root = join(getAppDataDir(), "repos"),
): string {
	const u = new URL(url.replace(/^([\w.-]+)@([^:]+):/, "ssh://$1@$2/"));
	const segments = urlSegments(url).map((s) =>
		s.replace(/[^A-Za-z0-9._-]/g, "_"),
	);
	const host = u.hostname.replace(/[^A-Za-z0-9._-]/g, "_");
	const name = segments.pop() ?? "repo";
	// The readable part is lossy (port dropped, characters folded); the hash keeps two remotes apart.
	const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
	return join(root, host, ...segments, `${name}-${hash}.git`);
}

/** https://user:token@host leaks through the mirror's config and logs; ssh://git@host is a username, not a secret. */
function hasEmbeddedSecret(url: string): boolean {
	if (!/^[a-z]+:\/\//.test(url)) return false;
	const u = new URL(url);
	return (
		u.password !== "" || (/^https?:$/.test(u.protocol) && u.username !== "")
	);
}

function urlSegments(url: string): string[] {
	const u = new URL(url.replace(/^([\w.-]+)@([^:]+):/, "ssh://$1@$2/"));
	return u.pathname
		.replace(/\.git$/, "")
		.split("/")
		.filter(Boolean);
}

function gitError(err: unknown): Error {
	const e = err as { stderr?: string; message?: string };
	const text = (e.stderr ?? e.message ?? String(err)).trim();
	return new Error(text || "git failed");
}

@Injectable()
export class RepoSourceService {
	private readonly logger = new Logger(RepoSourceService.name);
	private readonly inFlight = new Map<string, Promise<string>>();

	/** What save shows: the branch and commit the next snapshot would take, or the git error verbatim. */
	async validate(src: RepoSource): Promise<SourceCheck> {
		if (src.kind === "folder") return this.checkFolder(src.source);
		const mirror = await this.ensureMirror(src);
		return this.headOf(mirror, src.defaultBranch);
	}

	/** A folder may sit inside a repo; git clones only a top level, so the rest becomes the sub-path. */
	async checkFolder(folder: string): Promise<FolderCheck> {
		if (!existsSync(folder)) throw new Error(`No such folder: ${folder}`);
		const { stdout } = await this.git(
			["rev-parse", "--show-toplevel", "--show-prefix"],
			folder,
		);
		const [root = folder, prefix = ""] = stdout.split("\n");
		const check = await this.headOf(root);
		return { ...check, root, prefix: prefix.replace(/\/$/, "") };
	}

	/** A fresh clone of the committed HEAD into `dest`. Local clones hardlink objects, so both kinds are fast. */
	async snapshot(src: RepoSource, dest: string): Promise<Snapshot> {
		const from =
			src.kind === "folder" ? src.source : await this.ensureMirror(src);
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(join(dest, ".."), { recursive: true });
		const branch =
			src.kind === "url" ? src.defaultBranch?.trim() || null : null;
		await this.git([
			"clone",
			"--quiet",
			...(branch ? ["--branch", branch] : []),
			"--",
			from,
			dest,
		]);
		const check = await this.headOf(dest);
		const removed = await this.stripAgentConfig(dest);
		this.logger.log(
			`snapshot ${src.source} at ${check.head.slice(0, 12)} → ${dest}${removed.length ? ` (removed agent config: ${removed.join(", ")})` : ""}`,
		);
		return { path: dest, ...check };
	}

	/**
	 * Deletes repo-supplied agent config from the snapshot at any depth. opencode imports
	 * `.opencode/plugin/*.js` whatever OPENCODE_DISABLE_PROJECT_CONFIG or --pure say
	 * (verified on 1.18.30), so env flags alone let a repo run code on the host (#637).
	 */
	private async stripAgentConfig(dest: string): Promise<string[]> {
		const { stdout } = await this.git(["ls-files", "-z"], dest);
		const hits = new Set<string>();
		for (const file of stdout.split("\0").filter(Boolean)) {
			const parts = file.split("/");
			const at = parts.findIndex((p) => AGENT_CONFIG_NAMES.has(p));
			if (at >= 0) hits.add(parts.slice(0, at + 1).join("/"));
		}
		for (const path of hits)
			rmSync(join(dest, path), { recursive: true, force: true });
		return [...hits].sort();
	}

	/** Bare mirror under the app-data dir: cloned on first sight, fetched afterwards. Concurrent calls share one operation. */
	private ensureMirror(src: RepoSource): Promise<string> {
		const path = mirrorPathFor(src.source);
		const pending = this.inFlight.get(path);
		if (pending) return pending;
		const op = this.syncMirror(src, path).finally(() =>
			this.inFlight.delete(path),
		);
		this.inFlight.set(path, op);
		return op;
	}

	private async syncMirror(src: RepoSource, path: string): Promise<string> {
		const auth = gitAuthEnv(src);
		if (existsSync(join(path, "HEAD"))) {
			await this.git(["fetch", "--prune", "--quiet", "origin"], path, auth);
		} else {
			mkdirSync(join(path, ".."), { recursive: true });
			await this.git(
				["clone", "--mirror", "--quiet", "--", src.source, path],
				undefined,
				auth,
			);
		}
		return path;
	}

	private async headOf(
		cwd: string,
		preferBranch?: string | null,
	): Promise<SourceCheck> {
		const ref = preferBranch?.trim() || "HEAD";
		const { stdout: head } = await this.git(["rev-parse", ref], cwd);
		let branch: string | null = null;
		try {
			const { stdout } = await this.git(
				[
					"symbolic-ref",
					"--short",
					ref === "HEAD" ? "HEAD" : `refs/heads/${ref}`,
				],
				cwd,
			);
			branch = stdout.trim() || null;
		} catch {
			branch = ref === "HEAD" ? null : ref;
		}
		return { branch, head: head.trim() };
	}

	private async git(
		args: string[],
		cwd?: string,
		extraEnv: Record<string, string> = {},
	): Promise<{ stdout: string; stderr: string }> {
		try {
			return await run("git", args, {
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
				maxBuffer: 16 * 1024 * 1024,
				timeout: GIT_TIMEOUT_MS,
				killSignal: "SIGKILL",
			});
		} catch (err) {
			throw gitError(err);
		}
	}
}

/**
 * The connection token as an HTTPS auth header, passed through git's config env so it
 * never appears in argv (`ps`) or the mirror's config. Empty for ssh and scp remotes.
 */
export function gitAuthEnv(src: RepoSource): Record<string, string> {
	const token = src.token?.trim();
	if (!token || !/^https:\/\//.test(src.source)) return {};
	const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
	return {
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "http.extraheader",
		GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
	};
}
