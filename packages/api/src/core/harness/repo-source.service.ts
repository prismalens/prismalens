// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A service names its code as a local folder or a git URL. Every run gets a
 * fresh snapshot of the committed HEAD under the app-data dir, so the harness
 * cwd is never the user's checkout and never a worktree linked into it
 * (ADR 0004 §2, #629). A URL is kept as a bare mirror and refreshed before each
 * snapshot; a saved token rides as a per-command header, never in the URL or
 * the mirror's config.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";
import {
	type GitCredential,
	MACHINE_CREDENTIAL,
	repoPath,
	urlHost,
} from "./git-credential.js";
import { gitEnv } from "./git-env.js";
import { diagnoseGitFailure, GitFailure } from "./git-failure.js";
import {
	GIT_TIMEOUT_MS,
	GitSpawnError,
	remoteGitEnv,
	spawnGit,
} from "./git-spawn.js";

export { tokenUsernameFor } from "./git-credential.js";

export type RepoSourceKind = "folder" | "url";

export interface RepoSource {
	kind: RepoSourceKind;
	/** An absolute folder path, or a git URL (https, ssh, scp-style). */
	source: string;
	defaultBranch?: string | null;
	/** Who git authenticates as; absent means the machine's own git. */
	credential?: GitCredential;
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

/** Paths a supported harness loads as its own config, hooks, plugins or instructions when found in a repo. */
const AGENT_CONFIG_NAMES = new Set([
	".opencode",
	"opencode.json",
	"opencode.jsonc",
	".claude",
	".mcp.json",
	".gemini",
	".codex",
	// A repository's instructions to an agent; the brief is the run's only instruction (#673 w21).
	"AGENTS.md",
	"AGENTS.override.md",
	"CLAUDE.md",
	"GEMINI.md",
	".cursorrules",
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
				"Repository URL must not carry credentials; add a Git host token in Settings instead",
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

/** A git error a person can act on: the taxonomy for a remote call, git's own text otherwise. */
export function remoteFailure(err: unknown, src: RepoSource): Error {
	if (err instanceof GitFailure) return err;
	const url = src.credential?.effectiveUrl ?? src.source;
	const host = urlHost(url) ?? url;
	if (err instanceof GitSpawnError && err.timedOut)
		return new GitFailure(
			"unreachable",
			`Could not reach ${host}: ${err.message}.`,
		);
	if (err instanceof GitSpawnError)
		return diagnoseGitFailure({
			stderr: err.stderr || err.message,
			credential: (src.credential ?? MACHINE_CREDENTIAL).display,
			host,
			repo: repoPath(url),
			sshAuthSockSet: !!process.env.SSH_AUTH_SOCK,
		});
	return err instanceof Error ? err : new Error(String(err));
}

@Injectable()
export class RepoSourceService {
	private readonly logger = new Logger(RepoSourceService.name);
	private readonly inFlight = new Map<string, Promise<string>>();

	/** What save shows: the branch and commit the next snapshot would take, or why git could not. */
	async validate(src: RepoSource): Promise<SourceCheck> {
		if (src.kind === "folder") return this.checkFolder(src.source);
		const mirror = await this.ensureMirror(src);
		return this.headOf(mirror, src.defaultBranch);
	}

	/** Where to read history: the folder itself, or the URL's mirror after a fetch. */
	async gitDir(src: RepoSource): Promise<string> {
		return src.kind === "folder" ? src.source : this.ensureMirror(src);
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

	/**
	 * A fresh clone of the committed HEAD into `dest`. Local clones hardlink objects, so both kinds are fast.
	 * `signal` kills this run's git; a mirror refresh shared with other callers keeps going, this caller just stops waiting.
	 * `at` pins the clone to that commit instead (a follow-up rebuilds the first run's workspace, #747).
	 */
	async snapshot(
		src: RepoSource,
		dest: string,
		signal?: AbortSignal,
		at?: string,
	): Promise<Snapshot> {
		signal?.throwIfAborted();
		const from =
			src.kind === "folder"
				? src.source
				: await abortable(this.ensureMirror(src), signal);
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(join(dest, ".."), { recursive: true });
		const branch =
			src.kind === "url" && !at ? src.defaultBranch?.trim() || null : null;
		await this.git(
			[
				"clone",
				"--quiet",
				...(at ? ["--no-checkout"] : []),
				...(branch ? ["--branch", branch] : []),
				"--",
				from,
				dest,
			],
			undefined,
			signal,
		);
		if (at)
			await this.git(
				["-C", dest, "checkout", "--detach", "--quiet", at, "--"],
				undefined,
				signal,
			);
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

	/**
	 * Bare mirror under the app-data dir: cloned on first sight, fetched afterwards. Concurrent
	 * calls with the same credential share one operation; another credential gets its own fetch.
	 */
	private ensureMirror(src: RepoSource): Promise<string> {
		const path = mirrorPathFor(src.source);
		const key = `${path}\0${(src.credential ?? MACHINE_CREDENTIAL).key}`;
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const op = this.syncMirror(src, path).finally(() =>
			this.inFlight.delete(key),
		);
		this.inFlight.set(key, op);
		return op;
	}

	private async syncMirror(src: RepoSource, path: string): Promise<string> {
		const env = await remoteGitEnv(
			(src.credential ?? MACHINE_CREDENTIAL).envInput(src.source),
		);
		try {
			if (existsSync(join(path, "HEAD"))) {
				await spawnGit(["fetch", "--prune", "--quiet", "origin"], {
					cwd: path,
					env,
					timeoutMs: GIT_TIMEOUT_MS,
				});
			} else {
				mkdirSync(join(path, ".."), { recursive: true });
				await spawnGit(
					["clone", "--mirror", "--quiet", "--", src.source, path],
					{ env, timeoutMs: GIT_TIMEOUT_MS },
				);
			}
		} catch (err) {
			const failure = remoteFailure(err, src);
			if (failure instanceof GitFailure && failure.stderr)
				this.logger.warn(`git ${src.source}: ${failure.stderr.trim()}`);
			throw failure;
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

	/** A local git call: no remote, so no credential. */
	private async git(
		args: string[],
		cwd?: string,
		signal?: AbortSignal,
	): Promise<{ stdout: string; stderr: string }> {
		try {
			return await spawnGit(args, {
				cwd,
				signal,
				env: gitEnv({ source: "machine" }),
				timeoutMs: GIT_TIMEOUT_MS,
			});
		} catch (err) {
			if (signal?.aborted) throw signal.reason;
			throw err instanceof Error ? new Error(err.message) : err;
		}
	}
}

/** Stop waiting on `op` when `signal` aborts, without cancelling `op` for anyone else. */
function abortable<T>(op: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return op;
	return new Promise<T>((resolvePromise, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		op.then(resolvePromise, reject).finally(() =>
			signal.removeEventListener("abort", onAbort),
		);
	});
}
