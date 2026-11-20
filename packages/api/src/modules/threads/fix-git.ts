// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The git probes a fix thread's preview and Start run in a project's folder (#1176 D4, D7), argv only. */
import { tmpdir } from "node:os";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	GitSpawnError,
	remoteGitEnv,
	spawnGit,
} from "../../core/harness/git-spawn.js";

const FETCH_TIMEOUT_MS = 60_000;
const local = () => gitEnv({ source: "machine", coreSshCommand: null });

/** The folder holds `sha` as a commit. */
export async function hasCommit(folder: string, sha: string): Promise<boolean> {
	try {
		await spawnGit(["-C", folder, "cat-file", "-e", `${sha}^{commit}`], {
			cwd: tmpdir(),
			env: local(),
			timeoutMs: GIT_PROBE_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

/** Every push URL `origin` has; empty when it has none or git failed. */
export async function pushUrls(folder: string): Promise<string[]> {
	try {
		const { stdout } = await spawnGit(
			["-C", folder, "remote", "get-url", "--push", "--all", "origin"],
			{ cwd: tmpdir(), env: local(), timeoutMs: GIT_PROBE_TIMEOUT_MS },
		);
		return stdout
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

/** `git check-ref-format --branch` accepts it. */
export async function checkRef(ref: string): Promise<boolean> {
	try {
		await spawnGit(["check-ref-format", "--branch", ref], {
			cwd: tmpdir(),
			env: local(),
			timeoutMs: GIT_PROBE_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

/** Fetches one branch from `origin` without touching refs or FETCH_HEAD; the error's stderr, capped, when it fails. */
export async function fetchHead(
	folder: string,
	ref: string,
): Promise<{ ok: true } | { ok: false; stderr: string }> {
	try {
		await spawnGit(
			[
				"-C",
				folder,
				"fetch",
				"--no-tags",
				"--no-write-fetch-head",
				"origin",
				`refs/heads/${ref}`,
			],
			{
				cwd: tmpdir(),
				env: await remoteGitEnv({ source: "machine" }),
				timeoutMs: FETCH_TIMEOUT_MS,
			},
		);
		return { ok: true };
	} catch (e) {
		return {
			ok: false,
			stderr: (e instanceof GitSpawnError ? e.stderr : String(e)).slice(0, 300),
		};
	}
}

/** The branch a folder's HEAD is on, or null when detached or unreadable. */
export async function liveBranch(folder: string): Promise<string | null> {
	try {
		const { stdout } = await spawnGit(
			["-C", folder, "symbolic-ref", "-q", "--short", "HEAD"],
			{ cwd: tmpdir(), env: local(), timeoutMs: 3_000 },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}
