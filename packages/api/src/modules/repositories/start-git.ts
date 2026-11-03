// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	lstatSync,
	mkdirSync,
	realpathSync,
	rmSync,
	type Stats,
	statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	GitSpawnError,
	gitConfigRead,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { isCanonical } from "../../infrastructure/dispatch/folder-lock.js";

/** More files than this are left for the user to commit themselves. */
export const START_GIT_MAX_FILES = 5000;
const START_GIT_MS = 120_000;
const NULL_FILE = "/dev/null";

export class StartGitRefused extends Error {}

/** Folders a start is running in, by real path, so two starts never share one `.git`. */
const starting = new Set<string>();

const same = (a: Stats, b: Stats | undefined) =>
	!!b && a.dev === b.dev && a.ino === b.ino;

/**
 * Removes the `.git` this start made, only while the folder and that `.git` are still the
 * ones it made them in: never through a link, never another repository's (#1020).
 */
function undo(folder: string, dir: Stats, made: Stats | undefined): boolean {
	const now = lstatSync(folder, { throwIfNoEntry: false });
	if (!now || now.isSymbolicLink() || !same(dir, now)) return false;
	const git = join(folder, ".git");
	const was = lstatSync(git, { throwIfNoEntry: false });
	if (!was || was.isSymbolicLink() || !made || !same(made, was)) return false;
	rmSync(git, { recursive: true, force: true });
	return true;
}

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
 * hooks or signing; ignores are the folder's `.gitignore` and the user's global ignore file (#1020).
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

/** Only what locates the user's global config; nothing else of the server's env reaches git. */
const LOCATE = new Set([
	"HOME",
	"USERPROFILE",
	"HOMEDRIVE",
	"HOMEPATH",
	"XDG_CONFIG_HOME",
	"PATH",
	"SYSTEMROOT",
]);

const isFile = (p: string) => {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
};

/**
 * The user's own global ignore file, as git itself resolves it (`~` under HOME, else
 * USERPROFILE), else git's default place. A file set but unreadable refuses the start
 * rather than drop the user's ignores (#1020).
 */
async function globalExcludes(): Promise<string> {
	const parent = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => LOCATE.has(k.toUpperCase())),
	);
	const env = {
		...gitEnv({ source: "none", parent }),
		GIT_CONFIG_NOSYSTEM: "1",
	};
	let set = "";
	try {
		set = (
			await spawnGit(
				["config", "--global", "--type=path", "--get", "core.excludesFile"],
				{ cwd: tmpdir(), env, timeoutMs: GIT_PROBE_TIMEOUT_MS },
			)
		).stdout.trim();
	} catch (e) {
		// Exit 1 is "not set"; anything else means the setting could not be read.
		if (!(e instanceof GitSpawnError && e.exitCode === 1))
			throw new StartGitRefused("Your git ignore setting could not be read.");
	}
	if (set) {
		if (!isAbsolute(set) || !isFile(set))
			throw new StartGitRefused(
				`Your global git ignore file cannot be read: ${set}`,
			);
		return set;
	}
	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	const fallback = join(
		process.env.XDG_CONFIG_HOME || join(home, ".config"),
		"git",
		"ignore",
	);
	return isFile(fallback) ? fallback : NULL_FILE;
}

const PINNED = [
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
	opts: { maxFiles?: number; timeoutMs?: number; afterInit?: () => void } = {},
): Promise<void> {
	const st = lstatSync(folder, { throwIfNoEntry: false });
	if (!st || st.isSymbolicLink() || !st.isDirectory() || !isCanonical(folder))
		throw new StartGitRefused("This folder is gone or is a link.");
	const key = realpathSync(folder);
	if (starting.has(key))
		throw new StartGitRefused("Git is already starting here.");
	starting.add(key);
	try {
		await startIn(folder, st, opts);
	} finally {
		starting.delete(key);
	}
}

async function startIn(
	folder: string,
	dir: Stats,
	opts: { maxFiles?: number; timeoutMs?: number; afterInit?: () => void },
): Promise<void> {
	const who = await identity();
	if (!who)
		throw new StartGitRefused(
			"git has no user.name and user.email. Set them, then try again.",
		);
	const env = hardened(who);
	const excludes = ["-c", `core.excludesFile=${await globalExcludes()}`];
	const timeoutMs = opts.timeoutMs ?? START_GIT_MS;
	const git = (args: string[], ms = timeoutMs) => {
		// Each step runs only while the path still names the folder it started in.
		const now = lstatSync(folder, { throwIfNoEntry: false });
		if (!now || now.isSymbolicLink() || !same(dir, now))
			throw new StartGitRefused("This folder changed while git was starting.");
		return spawnGit([...PINNED, ...excludes, ...args], {
			cwd: folder,
			env,
			timeoutMs: ms,
		});
	};
	// Making `.git` ourselves is the claim: it fails if one is there, from anyone.
	try {
		mkdirSync(join(folder, ".git"));
	} catch {
		throw new StartGitRefused("This folder already has git.");
	}
	const made = lstatSync(join(folder, ".git"));
	try {
		await git(["init", "--quiet", "--template="], GIT_PROBE_TIMEOUT_MS);
		opts.afterInit?.();
	} catch (e) {
		undo(folder, dir, made);
		throw new StartGitRefused(failure("git init", e));
	}
	try {
		const max = opts.maxFiles ?? START_GIT_MAX_FILES;
		let count = 0;
		await git(["ls-files", "--others", "--exclude-standard", "-z"]).then(
			({ stdout }) => {
				count = stdout.split("\0").filter(Boolean).length;
			},
		);
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
		const undone = undo(folder, dir, made);
		const why =
			e instanceof StartGitRefused ? e.message : failure("git commit", e);
		throw new StartGitRefused(
			undone ? why : `${why} The folder changed, so its .git was left.`,
		);
	}
}

function failure(step: string, e: unknown): string {
	if (e instanceof GitSpawnError && e.timedOut) return `${step} took too long.`;
	return `${step} failed.`;
}
