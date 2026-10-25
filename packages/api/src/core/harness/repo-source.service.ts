// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A service names its code as a local folder or a git URL. Every run gets a
 * fresh snapshot of the committed HEAD under the app-data dir, never the user's
 * checkout: a folder as a worktree of it (#918), a URL as a clone of its bare
 * mirror, refreshed before each snapshot (ADR 0004 §2, #629). A saved token
 * rides as a per-command header, never in the URL or the mirror's config.
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
	repoLabel,
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
import { addRunWorktree } from "./run-worktree.js";

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
	/** A folder's worktree: the lock reason naming this attempt (#918). */
	lock?: string;
}

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
		// A URL's `#` is a fragment; in an scp path it is a path character, but `?` is refused either way (#848).
		if (
			/^[a-z]+:\/\//i.test(trimmed) ? /[?#]/.test(trimmed) : /\?/.test(trimmed)
		)
			throw new Error(
				"Repository URL must not carry a query string or fragment; add a Git host token in Settings instead",
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
	private readonly pathTail = new Map<string, Promise<string>>();

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
	 * The committed HEAD, or commit `at`, at `dest`: a locked worktree of a folder (#918), a clone of a URL's mirror.
	 * `signal` kills this run's git; a mirror refresh shared with other callers keeps going, this caller just stops waiting.
	 * `at` pins it to that commit (a follow-up rebuilds the first run's workspace, #747); `runId` names the lock.
	 */
	async snapshot(
		src: RepoSource,
		dest: string,
		signal?: AbortSignal,
		at?: string,
		runId?: string,
	): Promise<Snapshot> {
		signal?.throwIfAborted();
		let lock: string | undefined;
		if (src.kind === "folder") {
			const commit = at ?? (await this.headOf(src.source)).head;
			if (at && !(await this.hasCommit(src.source, at, signal)))
				throw new Error(
					`Commit ${at} could not be checked out from this source`,
				);
			try {
				lock = await addRunWorktree(
					src.source,
					dest,
					commit,
					runId ?? dest,
					signal,
				);
			} catch (err) {
				if (signal?.aborted) throw signal.reason;
				throw err instanceof Error ? new Error(err.message) : err;
			}
		} else await this.cloneMirror(src, dest, signal, at);
		const check = await this.headOf(dest);
		this.logger.log(
			`snapshot ${repoLabel(src.source)} at ${check.head.slice(0, 12)} → ${dest}`,
		);
		return { path: dest, ...check, ...(lock ? { lock } : {}) };
	}

	private async cloneMirror(
		src: RepoSource,
		dest: string,
		signal?: AbortSignal,
		at?: string,
	): Promise<void> {
		const from = await abortable(this.ensureMirror(src), signal);
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(join(dest, ".."), { recursive: true });
		const branch = !at ? src.defaultBranch?.trim() || null : null;
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
			).catch((err: unknown) => {
				if (signal?.aborted) throw err;
				throw new Error(
					`Commit ${at} could not be checked out from this source`,
				);
			});
		// origin is our mirror: refuse local-path push and fetch from the run (#676).
		await this.git(
			["-C", dest, "config", "protocol.file.allow", "never"],
			undefined,
			signal,
		);
	}

	/**
	 * Bare mirror under the app-data dir: cloned on first sight, fetched afterwards. Concurrent
	 * calls with the same credential share one operation; another credential gets its own fetch,
	 * queued behind the path's last one so two never clone or lock refs at once.
	 */
	private ensureMirror(src: RepoSource): Promise<string> {
		const path = mirrorPathFor(src.source);
		const key = `${path}\0${(src.credential ?? MACHINE_CREDENTIAL).key}`;
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const prev = this.pathTail.get(path) ?? Promise.resolve();
		const op: Promise<string> = prev
			.catch(() => undefined)
			.then(() => this.syncMirror(src, path))
			.finally(() => {
				this.inFlight.delete(key);
				if (this.pathTail.get(path) === op) this.pathTail.delete(path);
			});
		this.inFlight.set(key, op);
		this.pathTail.set(path, op);
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
				this.logger.warn(`git ${repoLabel(src.source)}: ${failure.code}`);
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
	/** False only when git confirms `at` names no commit in `repo` (exit 1); any other failure throws. */
	private async hasCommit(
		repo: string,
		at: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		try {
			await spawnGit(
				[
					"rev-parse",
					"--verify",
					"--quiet",
					"--end-of-options",
					`${at}^{commit}`,
				],
				{
					cwd: repo,
					signal,
					env: gitEnv({ source: "machine" }),
					timeoutMs: GIT_TIMEOUT_MS,
				},
			);
			return true;
		} catch (err) {
			if (err instanceof GitSpawnError && err.exitCode === 1) return false;
			throw err;
		}
	}

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
