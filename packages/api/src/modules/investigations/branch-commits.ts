// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The commits a thread's branch holds over its base, for the row's commit badge (#1020).
 * `<base>..HEAD` excludes all the base reaches, so a moved or merged-in base never changes it.
 */
import type { RunWorkspace } from "@prismalens/contracts";
import * as clock from "../../core/clock.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { baseEnv } from "./worktree-changes.js";

const git = async (cwd: string, args: string[]): Promise<string> =>
	(
		await spawnGit(["--no-replace-objects", ...args], {
			cwd,
			timeoutMs: GIT_PROBE_TIMEOUT_MS,
			env: baseEnv(),
		})
	).stdout.trim();

/** The base's upstream when it has one, since a local copy of it goes stale without a pull. */
async function baseOf(dir: string, from: string): Promise<string | null> {
	for (const ref of [`${from}@{upstream}`, from]) {
		const sha = await git(dir, ["rev-parse", "--verify", "-q", ref]).catch(
			() => "",
		);
		if (sha) return sha;
	}
	return null;
}

async function repoCommits(
	repo: RunWorkspace["repos"][number],
): Promise<number | null> {
	if (!repo.from) return null;
	try {
		const base = await baseOf(repo.dir, repo.from);
		if (!base) return null;
		const n = Number(
			await git(repo.dir, [
				"rev-list",
				"--count",
				"--no-merges",
				`${base}..HEAD`,
			]),
		);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

const TTL_MS = 15_000;
const GIT_LAYOUTS = new Set<RunWorkspace["layout"]>([
	"single",
	"multi",
	"in_place",
]);
const cache = new Map<string, { at: number; count: Promise<number | null> }>();

/** The workspace's commits over each repo's base, summed; null when no repo can tell. */
export function workspaceCommits(
	ws: RunWorkspace | null,
	now = clock.now(),
): Promise<number | null> {
	if (!ws || !GIT_LAYOUTS.has(ws.layout)) return Promise.resolve(null);
	const key = ws.repos.map((r) => `${r.dir}\0${r.from ?? ""}`).join("\0");
	const kept = cache.get(key);
	if (kept && now - kept.at < TTL_MS) return kept.count;
	const count = Promise.all(ws.repos.map(repoCommits)).then((all) => {
		const known = all.filter((n): n is number => n !== null);
		return known.length ? known.reduce((a, b) => a + b, 0) : null;
	});
	cache.set(key, { at: now, count });
	if (cache.size > 500) cache.delete(cache.keys().next().value as string);
	return count;
}
