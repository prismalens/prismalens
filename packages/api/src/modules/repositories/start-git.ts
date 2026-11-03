// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	GitSpawnError,
	gitConfigRead,
	spawnGit,
} from "../../core/harness/git-spawn.js";

/** More files than this are left for the user to commit themselves. */
export const START_GIT_MAX_FILES = 5000;
const START_GIT_MS = 120_000;
const NULL_FILE = "/dev/null";

export class StartGitRefused extends Error {}

/** The user's own name and email, read outside any repository; null when either is unset. */
async function identity(): Promise<{ name: string; email: string } | null> {
	const read = async (key: string) => {
		try {
			return (await gitConfigRead(["config", "--get", key])).stdout.trim();
		} catch {
			return "";
		}
	};
	const [name, email] = [await read("user.name"), await read("user.email")];
	return name && email ? { name, email } : null;
}

/**
 * No config but the identity reaches these calls: no system or global file, no template,
 * hooks or signing, and ignores come only from the folder's own `.gitignore` (#1020).
 */
function hardened(who: {
	name: string;
	email: string;
}): Record<string, string> {
	return {
		...gitEnv({ source: "none" }),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_ATTR_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: NULL_FILE,
		GIT_TEMPLATE_DIR: "",
		GIT_AUTHOR_NAME: who.name,
		GIT_AUTHOR_EMAIL: who.email,
		GIT_COMMITTER_NAME: who.name,
		GIT_COMMITTER_EMAIL: who.email,
	};
}

const PINNED = [
	"-c",
	`core.excludesFile=${NULL_FILE}`,
	"-c",
	`core.attributesFile=${NULL_FILE}`,
	"-c",
	`core.hooksPath=${NULL_FILE}`,
	"-c",
	"core.fsmonitor=false",
	"-c",
	"commit.gpgSign=false",
	"-c",
	"init.defaultBranch=main",
];

/**
 * `git init` in a plain folder, then one commit of what its `.gitignore` leaves, as the user.
 * Refuses with no identity, an existing `.git`, a link, or over START_GIT_MAX_FILES files;
 * a refusal after init removes the `.git` it made.
 */
export async function startGit(
	folder: string,
	opts: { maxFiles?: number; timeoutMs?: number } = {},
): Promise<void> {
	const st = lstatSync(folder, { throwIfNoEntry: false });
	if (!st || st.isSymbolicLink() || !st.isDirectory())
		throw new StartGitRefused("This folder is gone or is a link.");
	if (lstatSync(join(folder, ".git"), { throwIfNoEntry: false }))
		throw new StartGitRefused("This folder already has git.");
	const who = await identity();
	if (!who)
		throw new StartGitRefused(
			"git has no user.name and user.email. Set them, then try again.",
		);
	const env = hardened(who);
	const timeoutMs = opts.timeoutMs ?? START_GIT_MS;
	const git = (args: string[], ms = timeoutMs) =>
		spawnGit([...PINNED, ...args], { cwd: folder, env, timeoutMs: ms });
	try {
		await git(["init", "--quiet", "--template="], GIT_PROBE_TIMEOUT_MS);
	} catch (e) {
		throw new StartGitRefused(failure("git init", e));
	}
	try {
		const max = opts.maxFiles ?? START_GIT_MAX_FILES;
		let count = 0;
		await spawnGit(
			[...PINNED, "ls-files", "--others", "--exclude-standard", "-z"],
			{ cwd: folder, env, timeoutMs },
		).then(({ stdout }) => {
			count = stdout.split("\0").filter(Boolean).length;
		});
		if (count > max)
			throw new StartGitRefused(
				`Over ${max} files to commit. Commit them yourself.`,
			);
		await git(["add", "--all", "--", "."]);
		await git([
			"commit",
			"--quiet",
			"--no-verify",
			"--allow-empty",
			"-m",
			"Initial commit",
		]);
	} catch (e) {
		// Only the .git this call made: it was absent above, and rm does not follow a link.
		rmSync(join(folder, ".git"), { recursive: true, force: true });
		if (e instanceof StartGitRefused) throw e;
		throw new StartGitRefused(failure("git commit", e));
	}
}

function failure(step: string, e: unknown): string {
	if (e instanceof GitSpawnError && e.timedOut) return `${step} took too long.`;
	return `${step} failed.`;
}
