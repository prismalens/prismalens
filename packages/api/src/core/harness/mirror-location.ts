// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Where a git URL's one copy, its bare mirror, is cloned (#925): `<app data>/repos` unless
 * the user names a folder. A folder named before stays known until no workspace uses its
 * copies, so evidence reads and kept worktrees keep working after a move.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";
import { gitEnv } from "./git-env.js";
import { GIT_TIMEOUT_MS, spawnGit } from "./git-spawn.js";

const logger = new Logger("MirrorLocation");

let current: string | null = null;
let past: string[] = [];

export function defaultMirrorRoot(): string {
	return resolve(getAppDataDir(), "repos");
}

function rootOf(location: string | null): string {
	if (!location) return defaultMirrorRoot();
	return resolve(location.replace(/^~(?=$|[\\/])/, homedir()));
}

/** The folder setting, and folders named before it that may still hold copies. */
export function setMirrorLocations(
	location: string | null,
	previous: readonly (string | null)[] = [],
): void {
	current = location;
	past = previous.map(rootOf);
}

/** Where a new copy is cloned. */
export function mirrorRoot(): string {
	return rootOf(current);
}

/** Every folder a copy may be in, the current one first. */
export function mirrorRoots(): string[] {
	return [...new Set([mirrorRoot(), ...past])];
}

/** A bare repository `git clone --mirror` made: only those are ever deleted here. */
function isMirror(dir: string): boolean {
	try {
		return (
			existsSync(join(dir, "HEAD")) &&
			/^\s*mirror\s*=\s*true\s*$/m.test(
				readFileSync(join(dir, "config"), "utf8"),
			)
		);
	} catch {
		return false;
	}
}

/** Mirrors sit at `<root>/<host>/<path...>/<name>-<hash>.git`, the path as deep as the URL's; a copy is never walked into. */
function mirrorsUnder(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const dir = join(root, entry.name);
		if (entry.name.endsWith(".git") && isMirror(dir)) out.push(dir);
		else out.push(...mirrorsUnder(dir));
	}
	return out;
}

/**
 * Deletes each copy in a folder no longer the setting once no worktree hangs off it.
 * Answers the past folders still holding a copy; the caller keeps remembering those.
 */
export async function sweepOldMirrors(): Promise<string[]> {
	const now = mirrorRoot();
	const still: string[] = [];
	for (const root of past) {
		if (root === now) continue;
		let left = false;
		for (const mirror of mirrorsUnder(root)) {
			try {
				// Drops entries whose worktree folder is gone; a live run's is locked and stays.
				await spawnGit(["worktree", "prune"], {
					cwd: mirror,
					env: gitEnv({ source: "none" }),
					timeoutMs: GIT_TIMEOUT_MS,
				});
				const admin = join(mirror, "worktrees");
				if (existsSync(admin) && readdirSync(admin).length > 0) {
					left = true;
					continue;
				}
				rmSync(mirror, { recursive: true, force: true, maxRetries: 3 });
			} catch (e) {
				left = true;
				logger.warn(
					`Could not clear the old copy ${mirror}: ${(e as Error).message}`,
				);
			}
		}
		if (left) still.push(root);
	}
	return still;
}
