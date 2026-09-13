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
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";

const run = promisify(execFile);

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

const URL_LIKE = /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/;

/** Folder or URL; anything else is refused before git sees it. */
export function classifySource(input: string): {
	kind: RepoSourceKind;
	source: string;
} {
	const trimmed = input.trim();
	const expanded = trimmed.startsWith("~/")
		? join(homedir(), trimmed.slice(2))
		: trimmed;
	if (isAbsolute(expanded))
		return { kind: "folder", source: resolve(expanded) };
	if (URL_LIKE.test(trimmed)) return { kind: "url", source: trimmed };
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
	return join(root, host, ...segments, `${name}.git`);
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
			from,
			dest,
		]);
		const check = await this.headOf(dest);
		this.logger.log(
			`snapshot ${src.source} at ${check.head.slice(0, 12)} → ${dest}`,
		);
		return { path: dest, ...check };
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
		const auth = this.authArgs(src);
		if (existsSync(join(path, "HEAD"))) {
			await this.git([...auth, "fetch", "--prune", "--quiet", "origin"], path);
		} else {
			mkdirSync(join(path, ".."), { recursive: true });
			await this.git([
				...auth,
				"clone",
				"--mirror",
				"--quiet",
				src.source,
				path,
			]);
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
	): Promise<{ stdout: string; stderr: string }> {
		try {
			return await run("git", args, {
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				maxBuffer: 16 * 1024 * 1024,
			});
		} catch (err) {
			throw gitError(err);
		}
	}

	private authArgs(src: RepoSource): string[] {
		const token = src.token?.trim();
		if (!token || !/^https?:\/\//.test(src.source)) return [];
		const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
		return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
	}
}
