// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Real-git tests for worktree-snapshots (#1101 category 16).
 */
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	changedPaths,
	forgetNow,
	interruptedReverts,
	nowSnapshot,
	openStore,
	skippedOf,
	SnapshotUnavailable,
	snapshotsDirFor,
	statesAt,
	takeSnapshot,
	turnSnapshots,
} from "./worktree-snapshots.js";

const canSymlink = (() => {
	const dir = mkdtempSync(join(tmpdir(), "pl-symlink-snap-check-"));
	try {
		writeFileSync(join(dir, "target.txt"), "x");
		symlinkSync(join(dir, "target.txt"), join(dir, "link.txt"), "file");
		return true;
	} catch {
		return false;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
})();

describe("worktree-snapshots (#1101 category 16)", () => {
	let baseDir: string;
	let loc: string;
	let root: string;
	let runId: string;
	let repo: RunWorkspace["repos"][number];

	const git = (args: string[], cwd = root) =>
		execFileSync(
			"git",
			["-c", "user.email=t@t.local", "-c", "user.name=T", ...args],
			{ cwd, encoding: "utf8" },
		).trim();

	beforeEach(() => {
		baseDir = mkdtempSync(join(tmpdir(), "pl-snapshots-spec-"));
		process.env.PRISMALENS_WORKSPACE_DIR = join(baseDir, "data");
		runId = "11111111-2222-4333-8444-555555555555";
		loc = join(baseDir, "wt");
		root = join(loc, `pl-${runId}`);
		mkdirSync(root, { recursive: true });

		git(["init", "-q", "-b", "main"]);
		git(["config", "core.autocrlf", "false"]);
		writeFileSync(join(root, "file.txt"), "hello world\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "init"]);
		const head = git(["rev-parse", "HEAD"]);

		repo = {
			name: "repo",
			dir: root,
			sourceKind: "folder",
			url: root,
			subPath: null,
			connectionId: null,
			head,
			branch: "main",
			services: [],
		};
	});

	afterEach(() => {
		rmSync(baseDir, { recursive: true, force: true });
	});

	it("snapshotsDirFor validates run id and rejects invalid characters or directory traversal", () => {
		expect(() => snapshotsDirFor("run/slash")).toThrowError(
			"Invalid run id for snapshots: run/slash",
		);
		expect(() => snapshotsDirFor("run..dots")).toThrowError(
			"Invalid run id for snapshots: run..dots",
		);
		expect(snapshotsDirFor("valid-run_123")).toContain("valid-run_123");
	});

	it("openStore rejects non-existent repo directory with removed", async () => {
		const nonExistentRepo = {
			...repo,
			dir: join(loc, "does-not-exist"),
		};
		await expect(
			openStore(runId, 0, nonExistentRepo, [loc]),
		).rejects.toThrowError(new SnapshotUnavailable("removed"));
	});

	it("openStore rejects relative path or a regular file in place of repo dir with not-a-workspace", async () => {
		const relativeRepo = {
			...repo,
			dir: "relative/path",
		};
		await expect(
			openStore(runId, 0, relativeRepo, [loc]),
		).rejects.toThrowError(new SnapshotUnavailable("not-a-workspace"));

		const filePath = join(loc, "regular-file.txt");
		writeFileSync(filePath, "regular file");
		const fileRepo = {
			...repo,
			dir: filePath,
		};
		await expect(
			openStore(runId, 0, fileRepo, [loc]),
		).rejects.toThrowError(new SnapshotUnavailable("not-a-workspace"));
	});

	it.skipIf(!canSymlink)(
		"openStore rejects symlink in place of repo dir with not-a-workspace",
		async () => {
			const symlinkPath = join(loc, "symlinked-repo");
			symlinkSync(root, symlinkPath, "dir");
			const symRepo = {
				...repo,
				dir: symlinkPath,
			};
			await expect(
				openStore(runId, 0, symRepo, [loc]),
			).rejects.toThrowError(new SnapshotUnavailable("not-a-workspace"));
		},
	);

	it("openStore rejects invalid head commit sha with commit-gone", async () => {
		const badHeadRepo = {
			...repo,
			head: "not-a-valid-sha",
		};
		await expect(
			openStore(runId, 0, badHeadRepo, [loc]),
		).rejects.toThrowError(new SnapshotUnavailable("commit-gone"));
	});

	it("openStore rejects repo dir outside roots with not-a-workspace", async () => {
		const otherLoc = join(baseDir, "other-loc");
		await expect(
			openStore(runId, 0, repo, [otherLoc]),
		).rejects.toThrowError(new SnapshotUnavailable("not-a-workspace"));
	});

	it("openStore rejects sparse checkout with unsupported", async () => {
		git(["config", "core.sparseCheckout", "true"]);
		await expect(
			openStore(runId, 0, repo, [loc]),
		).rejects.toThrowError(new SnapshotUnavailable("unsupported"));
	});

	it("skippedOf returns string array on valid JSON and empty array on broken JSON or non-JSON", () => {
		expect(skippedOf("PrismaLens snapshot\n\n{\"skipped\":[\"a.txt\",\"b.txt\"]}\n")).toEqual([
			"a.txt",
			"b.txt",
		]);
		expect(skippedOf("PrismaLens snapshot without json")).toEqual([]);
		expect(skippedOf("PrismaLens snapshot\n\n{invalid json")).toEqual([]);
		expect(skippedOf("PrismaLens snapshot\n\n{\"skipped\":\"not-array\"}\n")).toEqual([]);
	});

	it("takeSnapshot skips untracked file over 512 KB and drops file captured once then added to .gitignore", async () => {
		const store = await openStore(runId, 0, repo, [loc]);

		// Untracked file over 512 KB (512 * 1024 + 1 bytes)
		const bigBuf = Buffer.alloc(512 * 1024 + 1, "a");
		writeFileSync(join(root, "big.txt"), bigBuf);

		const snap1 = await takeSnapshot(store);
		expect(snap1.skipped).toContain("big.txt");

		// Untracked small file captured once
		writeFileSync(join(root, "temp.txt"), "temporary content\n");
		const snap2 = await takeSnapshot(store);
		expect(snap2.skipped).not.toContain("temp.txt");

		const treeEntries2 = await store.git(["ls-tree", "--name-only", snap2.commit]);
		expect(treeEntries2.split("\n")).toContain("temp.txt");

		// Now add temp.txt to .gitignore -> next snapshot drops it from index
		writeFileSync(join(root, ".gitignore"), "temp.txt\n");
		const snap3 = await takeSnapshot(store);
		const treeEntries3 = await store.git(["ls-tree", "--name-only", snap3.commit]);
		expect(treeEntries3.split("\n")).not.toContain("temp.txt");
	});

	it("takeSnapshot with an aborted signal rejects with AbortError and writes no ref", async () => {
		const store = await openStore(runId, 0, repo, [loc]);
		const controller = new AbortController();
		controller.abort();

		await expect(
			takeSnapshot(store, {
				ref: "refs/pl/turn/1/start",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });

		const checkRef = await store
			.git(["rev-parse", "--verify", "-q", "refs/pl/turn/1/start"])
			.catch(() => "");
		expect(checkRef).toBe("");
	});

	it("nowSnapshot returns the same commit for two calls within 2 s; forgetNow makes the next call take a new snapshot", async () => {
		const store = await openStore(runId, 0, repo, [loc]);

		const snap1 = await nowSnapshot(store);
		writeFileSync(join(root, "file.txt"), "modified file\n");
		const snap2 = await nowSnapshot(store);
		expect(snap2.commit).toBe(snap1.commit);

		forgetNow(store);
		const snap3 = await nowSnapshot(store);
		expect(snap3.commit).not.toBe(snap1.commit);
	});

	it("interruptedReverts detects refs with before and target without after", async () => {
		const store = await openStore(runId, 0, repo, [loc]);
		const head = repo.head;

		await store.git(["update-ref", "refs/pl/revert/101/before", head]);
		await store.git(["update-ref", "refs/pl/revert/101/target", head]);

		await store.git(["update-ref", "refs/pl/revert/102/before", head]);
		await store.git(["update-ref", "refs/pl/revert/102/target", head]);
		await store.git(["update-ref", "refs/pl/revert/102/after", head]);

		const interrupted = await interruptedReverts(store);
		expect(interrupted).toEqual(["101"]);
	});

	it("turnSnapshots sorts by sequence and parses start and end refs", async () => {
		const store = await openStore(runId, 0, repo, [loc]);
		const head = repo.head;

		await store.git(["update-ref", "refs/pl/turn/2/start", head]);
		await store.git(["update-ref", "refs/pl/turn/2/end", head]);
		await store.git(["update-ref", "refs/pl/turn/1/start", head]);

		const turns = await turnSnapshots(store);
		expect(turns).toEqual([
			{ seq: 1, start: head, end: null },
			{ seq: 2, start: head, end: head },
		]);
	});

	it("changedPaths and statesAt handle empty and changed paths", async () => {
		const store = await openStore(runId, 0, repo, [loc]);
		const snap1 = await takeSnapshot(store);

		writeFileSync(join(root, "file.txt"), "new content\n");
		writeFileSync(join(root, "added.txt"), "added content\n");
		const snap2 = await takeSnapshot(store);

		const paths = await changedPaths(store, snap1.commit, snap2.commit);
		expect(paths.sort()).toEqual(["added.txt", "file.txt"]);

		const emptyStates = await statesAt(store, snap2.commit, []);
		expect(emptyStates.size).toBe(0);

		const states = await statesAt(store, snap2.commit, ["added.txt", "nonexistent.txt"]);
		expect(states.get("nonexistent.txt")).toBe("absent");
		expect(states.get("added.txt")).toMatch(/^100644 [0-9a-f]+$/);
	});
});
