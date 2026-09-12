// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigated repos are cloned by prismalens under the app-data dir; the
 * harness cwd is never the user's own checkout (ADR 0004 §2, #597 slice 3).
 * A token, when the connection has one, is sent as a per-command header and
 * never written into the clone's config.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";

const run = promisify(execFile);

export interface CloneTarget {
	url: string;
	defaultBranch?: string | null;
	/** Bearer-style token for HTTPS remotes (GitHub PAT or App installation token). */
	token?: string | null;
}

export interface CloneResult {
	path: string;
	head: string;
	/** "cloned" on first sight, "updated" afterwards. */
	action: "cloned" | "updated";
}

export function clonePathFor(
	url: string,
	root = join(getAppDataDir(), "repos"),
): string {
	const u = new URL(url.replace(/^git@([^:]+):/, "https://$1/"));
	const segments = u.pathname
		.replace(/\.git$/, "")
		.split("/")
		.filter(Boolean)
		.map((s) => s.replace(/[^A-Za-z0-9._-]/g, "_"));
	return join(root, u.hostname, ...segments);
}

@Injectable()
export class RepoCloneService {
	private readonly logger = new Logger(RepoCloneService.name);
	private readonly inFlight = new Map<string, Promise<CloneResult>>();

	/** Idempotent: clone on first sight, fetch and fast-forward afterwards. Concurrent calls share one operation. */
	ensureClone(target: CloneTarget): Promise<CloneResult> {
		const path = clonePathFor(target.url);
		const pending = this.inFlight.get(path);
		if (pending) return pending;
		const op = this.sync(target, path).finally(() =>
			this.inFlight.delete(path),
		);
		this.inFlight.set(path, op);
		return op;
	}

	private async sync(target: CloneTarget, path: string): Promise<CloneResult> {
		const git = (args: string[], cwd?: string) =>
			run("git", [...this.authArgs(target), ...args], {
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				maxBuffer: 16 * 1024 * 1024,
			});
		const branch = target.defaultBranch?.trim() || null;
		let action: CloneResult["action"];
		if (existsSync(join(path, ".git"))) {
			await git(["fetch", "--prune", "origin"], path);
			const ref = branch ? `origin/${branch}` : "origin/HEAD";
			await git(["checkout", "--quiet", "--force", "--detach", ref], path);
			action = "updated";
		} else {
			mkdirSync(join(path, ".."), { recursive: true });
			await git([
				"clone",
				"--quiet",
				...(branch ? ["--branch", branch] : []),
				target.url,
				path,
			]);
			action = "cloned";
		}
		const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: path });
		const head = stdout.trim();
		this.logger.log(
			`${action} ${target.url} at ${head.slice(0, 12)} → ${path}`,
		);
		return { path, head, action };
	}

	private authArgs(target: CloneTarget): string[] {
		const token = target.token?.trim();
		if (!token || !/^https?:\/\//.test(target.url)) return [];
		const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
		return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
	}
}
