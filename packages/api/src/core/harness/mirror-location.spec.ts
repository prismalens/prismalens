// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Where a git URL is cloned once, and moving that folder (#925), on real git. */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { objectDirFor } from "../../modules/investigations/evidence-blob.js";
import {
	mirrorRoot,
	setMirrorLocations,
	sweepOldMirrors,
} from "./mirror-location.js";
import { mirrorPathFor, RepoSourceService } from "./repo-source.service.js";
import { DEFAULT_RUN_WORKSPACE_SETTINGS } from "@prismalens/contracts";
import { releaseWorktreesIn, setRunWorkspaceSource } from "./run-worktree.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const git = (args: string[], cwd: string) =>
	execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();

let tmp: string;
let saved: string | undefined;

/** A file:// remote with one commit on main. */
function remote(): string {
	const work = join(tmp, "work");
	git(["init", "-q", "-b", "main", work], tmp);
	writeFileSync(join(work, "a.txt"), "v1");
	git(["add", "a.txt"], work);
	git(["-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "-q", "-m", "init"], work);
	const bare = join(tmp, "remote.git");
	git(["clone", "-q", "--bare", work, bare], tmp);
	return `file://${bare}`;
}

const snap = (url: string, dest: string, run: string) =>
	new RepoSourceService().snapshot(
		{ kind: "url", source: url, defaultBranch: "main" },
		dest,
		undefined,
		undefined,
		run,
	);

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "pl-copies-"));
	saved = process.env.PRISMALENS_WORKSPACE_DIR;
	process.env.PRISMALENS_WORKSPACE_DIR = join(tmp, "app");
	setMirrorLocations(null);
	// Remove unless changed, so a released worktree lets go of its copy (the default keeps it).
	setRunWorkspaceSource({
		global: () => ({ ...DEFAULT_RUN_WORKSPACE_SETTINGS, retention: { kind: "remove-unless-changed" } }),
		override: () => undefined,
		locations: () => [],
		serviceIdOf: async () => null,
		record: () => {},
	});
});

afterEach(() => {
	setRunWorkspaceSource(null);
	setMirrorLocations(null);
	if (saved === undefined) delete process.env.PRISMALENS_WORKSPACE_DIR;
	else process.env.PRISMALENS_WORKSPACE_DIR = saved;
	rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

describe("the cloned copies folder", () => {
	it("defaults to repos in the data folder, and a new folder takes the next clone", async () => {
		const url = remote();
		expect(mirrorRoot()).toBe(join(tmp, "app", "repos"));
		await snap(url, join(tmp, "ws", "pl-r1"), "r1");
		expect(existsSync(join(mirrorPathFor(url, join(tmp, "app", "repos")), "HEAD"))).toBe(true);

		const moved = join(tmp, "copies");
		setMirrorLocations(moved, [join(tmp, "app", "repos")]);
		await snap(url, join(tmp, "ws", "pl-r2"), "r2");
		expect(existsSync(join(mirrorPathFor(url, moved), "HEAD"))).toBe(true);
		await releaseWorktreesIn(join(tmp, "ws", "pl-r1"));
		await releaseWorktreesIn(join(tmp, "ws", "pl-r2"));
	});

	it("an old copy is still read for evidence, and removed once no worktree uses it", async () => {
		const url = remote();
		const old = join(tmp, "app", "repos");
		const kept = join(tmp, "ws", "pl-r1");
		await snap(url, kept, "r1");
		setMirrorLocations(join(tmp, "copies"), [old]);
		const recorded = { sourceKind: "url", url } as Parameters<typeof objectDirFor>[0];
		expect(objectDirFor(recorded)).toBe(mirrorPathFor(url, old));

		// The run's worktree still hangs off the old copy: it stays.
		expect(await sweepOldMirrors()).toEqual([old]);
		expect(existsSync(mirrorPathFor(url, old))).toBe(true);

		await releaseWorktreesIn(kept);
		expect(await sweepOldMirrors()).toEqual([]);
		expect(existsSync(mirrorPathFor(url, old))).toBe(false);
	});

	it("keeps the current copies when the new folder sits inside an old one", async () => {
		const url = remote();
		const old = join(tmp, "copies");
		const now = join(old, "nested");
		setMirrorLocations(now, [old]);
		const ws = join(tmp, "ws", "pl-r1");
		await snap(url, ws, "r1");
		await releaseWorktreesIn(ws);
		await sweepOldMirrors();
		expect(existsSync(join(mirrorPathFor(url, now), "HEAD"))).toBe(true);
	});

	it("never deletes a folder in an old location that is not a copy it made", async () => {
		const old = join(tmp, "old");
		const theirs = join(old, "host", "theirs.git");
		mkdirSync(theirs, { recursive: true });
		git(["init", "-q", "--bare", theirs], tmp);
		setMirrorLocations(join(tmp, "copies"), [old]);
		await sweepOldMirrors();
		expect(existsSync(join(theirs, "HEAD"))).toBe(true);
	});

	it("never deletes a --mirror clone the user made in an old location", async () => {
		const url = remote();
		const old = join(tmp, "old");
		const theirs = join(old, "host", "personal.git");
		mkdirSync(join(old, "host"), { recursive: true });
		git(["clone", "-q", "--mirror", url, theirs], tmp);
		setMirrorLocations(join(tmp, "copies"), [old]);
		await sweepOldMirrors();
		expect(existsSync(join(theirs, "HEAD"))).toBe(true);
	});
});
