// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Real-git tests for turn snapshots, diff scopes and revert (#1101 category 16).
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunWorkspace, ScopedDiff } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	forgetNow,
	openStore,
	takeSnapshot,
	withStoreLock,
} from "./worktree-snapshots.js";
import {
	readChangesFile,
	readChangesPatch,
	readScopedChanges,
	revertChanges,
	snapshotTurn,
} from "./worktree-scopes.js";

vi.setConfig({ testTimeout: 69_000 }); // slowest test 22982 ms; 3x, rounded up to the second, at least 5 s (#1154)

const canSymlink = (() => {
	const dir = mkdtempSync(join(tmpdir(), "pl-symlink-check-"));
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

describe("worktree-scopes (#1101 category 16)", () => {
	let baseDir: string;
	let loc: string;
	let root: string;
	let runId: string;
	let ws: RunWorkspace;
	let ctx: { runId: string; running: boolean; canWrite: boolean; roots: string[] };
	const sig = new AbortController().signal;

	const git = (args: string[], cwd = root) =>
		execFileSync("git", ["-c", "user.email=t@t.local", "-c", "user.name=T", ...args], {
			cwd,
			encoding: "utf8",
		}).trim();

	beforeEach(() => {
		baseDir = mkdtempSync(join(tmpdir(), "pl-scopes-spec-"));
		process.env.PRISMALENS_WORKSPACE_DIR = join(baseDir, "data");
		runId = "11111111-2222-4333-8444-555555555555";
		loc = join(baseDir, "wt");
		root = join(loc, `pl-${runId}`);
		mkdirSync(root, { recursive: true });

		git(["init", "-q", "-b", "main"]);
		git(["config", "core.autocrlf", "false"]);
		writeFileSync(
			join(root, "a.txt"),
			"one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		writeFileSync(join(root, ".gitignore"), "ignored.log\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "init"]);
		const head = git(["rev-parse", "HEAD"]);

		ws = {
			layout: "single",
			cwd: root,
			repos: [
				{
					name: "repo",
					dir: root,
					sourceKind: "folder",
					url: root,
					subPath: null,
					connectionId: null,
					head,
					branch: "main",
					services: [],
				},
			],
		};
		ctx = { runId, running: false, canWrite: true, roots: [loc] };
	});

	afterEach(() => {
		rmSync(baseDir, { recursive: true, force: true });
	});

	it("scope all lists exact status, path, +/- for modified tracked file and untracked file; gitignored file is not listed", async () => {
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		writeFileSync(join(root, "new.txt"), "hello world\n");
		writeFileSync(join(root, "ignored.log"), "secret\n");

		const res = await readScopedChanges(ws, "all", undefined, ctx);
		const repo = res.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(repo)}`);

		const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
		expect(byPath["a.txt"]).toEqual({
			path: "a.txt",
			status: "modified",
			additions: 1,
			deletions: 1,
		});
		expect(byPath["new.txt"]).toEqual({
			path: "new.txt",
			status: "added",
			additions: 1,
			deletions: 0,
		});
		expect(byPath["ignored.log"]).toBeUndefined();
	});

	it("scope turn with snapshotTurn start/end around agent edits lists only the turn's files; scoped.turn equals the turn id; scoped.live false after end", async () => {
		await snapshotTurn(ws, runId, "start", 10, sig, [loc]);
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		await snapshotTurn(ws, runId, "end", 10, sig, [loc]);

		const res = await readScopedChanges(ws, "turn", 10, ctx);
		const repo = res.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(repo)}`);

		expect(repo.files.map((f) => f.path)).toEqual(["a.txt"]);
		const scoped = repo.scoped as ScopedDiff;
		expect(scoped.turn).toBe(10);
		expect(scoped.live).toBe(false);
	});

	// The refs are read in the lock the snapshot is taken in: a turn end queued ahead is in the answer (#1197 review).
	it("a turn end snapshot queued ahead of the read is in the diff it returns", async () => {
		await snapshotTurn(ws, runId, "start", 10, sig, [loc]);
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		const store = await openStore(runId, 0, ws.repos[0] as RunWorkspace["repos"][number], [loc]);
		let release: () => void = () => {};
		const held = withStoreLock(store.gitDir, () => new Promise<void>((r) => (release = r)));
		const end = withStoreLock(store.gitDir, async () => {
			forgetNow(store);
			return takeSnapshot(store, { ref: "refs/pl/turn/10/end" });
		});
		const read = readScopedChanges(ws, "turn", 10, ctx);
		await new Promise((r) => setTimeout(r, 1500));
		release();
		await Promise.all([held, end]);

		const repo = (await read).repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(repo)}`);
		expect(repo.files.map((f) => f.path)).toEqual(["a.txt"]);
		expect((repo.scoped as ScopedDiff).live).toBe(false);
	});

	it("a file written after the turn's end appears in scoped.outside and in scope outside, and not in scope turn", async () => {
		await snapshotTurn(ws, runId, "start", 10, sig, [loc]);
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		await snapshotTurn(ws, runId, "end", 10, sig, [loc]);

		writeFileSync(join(root, "after.txt"), "outside file\n");

		const turnRes = await readScopedChanges(ws, "turn", 10, ctx);
		const turnRepo = turnRes.repos[0];
		expect(turnRepo?.state).toBe("ok");
		if (turnRepo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(turnRepo)}`);
		expect(turnRepo.files.some((f) => f.path === "after.txt")).toBe(false);
		const turnScoped = turnRepo.scoped as ScopedDiff;
		expect(turnScoped.outside).toEqual(["after.txt"]);

		const outsideRes = await readScopedChanges(ws, "outside", undefined, ctx);
		const outsideRepo = outsideRes.repos[0];
		expect(outsideRepo?.state).toBe("ok");
		if (outsideRepo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(outsideRepo)}`);
		expect(outsideRepo.files.map((f) => f.path)).toEqual(["after.txt"]);
	});

	it("scope turn with no snapshot answers {state: unavailable, reason: no-snapshot}", async () => {
		const res = await readScopedChanges(ws, "turn", 99, ctx);
		const repo = res.repos[0];
		expect(repo).toEqual({
			state: "unavailable",
			repo: "repo",
			reason: "no-snapshot",
		});
	});

	it("a hard-linked file is listed with status link and in scoped.skipped, and its content never appears in patch", async () => {
		const outside = join(baseDir, "outside");
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "secret.txt"), "TOP-SECRET-HARDLINK\n");
		linkSync(join(outside, "secret.txt"), join(root, "hard.txt"));

		const res = await readScopedChanges(ws, "all", undefined, ctx);
		const repo = res.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(repo)}`);

		const f = repo.files.find((file) => file.path === "hard.txt");
		expect(f).toEqual({
			path: "hard.txt",
			status: "link",
			additions: null,
			deletions: null,
		});
		const scoped = repo.scoped as ScopedDiff;
		expect(scoped.skipped).toContain("hard.txt");
		expect(repo.patch ?? "").not.toContain("TOP-SECRET-HARDLINK");
	});

	it.skipIf(!canSymlink)(
		"a symlinked untracked file is listed with status link and in scoped.skipped, and its content never appears in patch (skipped on win32 without symlink privilege)",
		async () => {
			const outside = join(baseDir, "outside-sym");
			mkdirSync(outside, { recursive: true });
			writeFileSync(join(outside, "secret.txt"), "TOP-SECRET-SYMLINK\n");
			symlinkSync(join(outside, "secret.txt"), join(root, "symlink.txt"), "file");

			const res = await readScopedChanges(ws, "all", undefined, ctx);
			const repo = res.repos[0];
			expect(repo?.state).toBe("ok");
			if (repo?.state !== "ok") throw new Error(`expected an ok diff, got ${JSON.stringify(repo)}`);

			const f = repo.files.find((file) => file.path === "symlink.txt");
			expect(f).toEqual({
				path: "symlink.txt",
				status: "link",
				additions: null,
				deletions: null,
			});
			const scoped = repo.scoped as ScopedDiff;
			expect(scoped.skipped).toContain("symlink.txt");
			expect(repo.patch ?? "").not.toContain("TOP-SECRET-SYMLINK");
		},
	);

	it("hunk revert of the second hunk changes only those lines, returns state done and a revertId; repeating it with old expect returns refused stale", async () => {
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const hunks = (all.patch ?? "")
			.split("\n")
			.filter((l) => l.startsWith("@@"));
		expect(hunks).toHaveLength(2);

		const allScoped = all.scoped as ScopedDiff;
		const result = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "hunk", path: "a.txt", header: hunks[1] as string },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			ctx,
		);

		expect(result.state).toBe("done");
		if (result.state !== "done") throw new Error(`expected done, got ${JSON.stringify(result)}`);
		expect(result.paths).toEqual(["a.txt"]);
		expect(typeof result.revertId).toBe("string");
		expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);

		const repeat = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "hunk", path: "a.txt", header: hunks[1] as string },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			ctx,
		);
		expect(repeat).toEqual({
			state: "refused",
			reason: "stale",
			paths: ["a.txt"],
			block: null,
		});
	});

	it("undo of that revert restores the exact previous text", async () => {
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const hunks = (all.patch ?? "")
			.split("\n")
			.filter((l) => l.startsWith("@@"));
		const allScoped = all.scoped as ScopedDiff;
		const rev = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "hunk", path: "a.txt", header: hunks[1] as string },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			ctx,
		);
		expect(rev.state).toBe("done");
		if (rev.state !== "done") throw new Error(`expected done, got ${JSON.stringify(rev)}`);

		const undoRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "undo", revertId: rev.revertId },
				expect: {},
			},
			ctx,
		);
		expect(undoRes).toEqual({
			state: "done",
			revertId: expect.any(String),
			paths: ["a.txt"],
			kept: [],
		});
		expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);
	});

	it("file revert of an untracked file deletes it", async () => {
		writeFileSync(join(root, "new.txt"), "untracked content\n");
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const allScoped = all.scoped as ScopedDiff;
		const rev = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "new.txt" },
				expect: { "new.txt": allScoped.states["new.txt"] as string },
			},
			ctx,
		);
		expect(rev).toEqual({
			state: "done",
			revertId: expect.any(String),
			paths: ["new.txt"],
			kept: [],
		});
		expect(existsSync(join(root, "new.txt"))).toBe(false);
	});

	it("file revert of a path whose attributes run a filter writes nothing and reports it kept as filtered (#1193)", async () => {
		writeFileSync(join(root, ".gitattributes"), "f.txt filter=pl-none\n");
		writeFileSync(join(root, "f.txt"), "f0\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "attributes"]);
		ws.repos[0] = { ...(ws.repos[0] as RunWorkspace["repos"][number]), head: git(["rev-parse", "HEAD"]).trim() };
		writeFileSync(join(root, "f.txt"), "f1\n");
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const allScoped = all.scoped as ScopedDiff;

		const rev = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "f.txt" },
				expect: { "f.txt": allScoped.states["f.txt"] as string },
			},
			ctx,
		);

		expect(rev).toEqual({
			state: "done",
			revertId: expect.any(String),
			paths: [],
			kept: [{ path: "f.txt", why: "filtered" }],
		});
		expect(readFileSync(join(root, "f.txt"), "utf8")).toBe("f1\n");
	});

	it("turn undo when a turn path changed since the end returns reason conflict with exactly that path, and writes nothing (assert file texts unchanged)", async () => {
		await snapshotTurn(ws, runId, "start", 10, sig, [loc]);
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);
		await snapshotTurn(ws, runId, "end", 10, sig, [loc]);

		writeFileSync(
			join(root, "a.txt"),
			"MODIFIED_AFTER\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);

		const res = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "turn",
				from: "",
				target: { kind: "turn", seq: 10 },
				expect: {},
			},
			ctx,
		);
		expect(res).toEqual({
			state: "refused",
			reason: "conflict",
			paths: ["a.txt"],
			block: null,
		});
		expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(
			"MODIFIED_AFTER\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);
	});

	it("turn undo when files equal the end state restores the start state and keeps a file the user created outside the turn", async () => {
		await snapshotTurn(ws, runId, "start", 10, sig, [loc]);
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n",
		);
		writeFileSync(join(root, "new.txt"), "agent file\n");
		await snapshotTurn(ws, runId, "end", 10, sig, [loc]);

		writeFileSync(join(root, "user.txt"), "user file outside turn\n");

		const res = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "turn",
				from: "",
				target: { kind: "turn", seq: 10 },
				expect: {},
			},
			ctx,
		);
		expect(res).toEqual({
			state: "done",
			revertId: expect.any(String),
			paths: expect.arrayContaining(["a.txt", "new.txt"]),
			kept: [],
		});
		expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(
			"one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		expect(existsSync(join(root, "new.txt"))).toBe(false);
		expect(readFileSync(join(root, "user.txt"), "utf8")).toBe(
			"user file outside turn\n",
		);
	});

	it("canWrite:false returns {state: refused, reason: blocked, block: view-only}; running:true returns block running; a workspace with layout in_place returns block borrowed", async () => {
		writeFileSync(join(root, "a.txt"), "changed\n");
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const allScoped = all.scoped as ScopedDiff;
		const r1 = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "a.txt" },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			{ ...ctx, canWrite: false },
		);
		expect(r1).toEqual({
			state: "refused",
			reason: "blocked",
			paths: [],
			block: "view-only",
		});

		const r2 = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "a.txt" },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			{ ...ctx, running: true },
		);
		expect(r2).toEqual({
			state: "refused",
			reason: "blocked",
			paths: [],
			block: "running",
		});

		const inPlaceWs: RunWorkspace = {
			...ws,
			layout: "in_place",
			borrowed: {
				path: root,
				head: ws.repos[0]?.head ?? "",
				branch: "main",
				dirty: { staged: 0, unstaged: 0, untracked: 0 },
			},
		};
		const r3 = await revertChanges(
			inPlaceWs,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "a.txt" },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			ctx,
		);
		expect(r3).toEqual({
			state: "refused",
			reason: "blocked",
			paths: [],
			block: "borrowed",
		});
	});

	it("a worktree folder not named pl-<runId> under the roots is refused with block borrowed", async () => {
		const otherRoot = join(loc, "other-folder");
		mkdirSync(otherRoot, { recursive: true });
		git(["init", "-q", "-b", "main"], otherRoot);
		git(["config", "core.autocrlf", "false"], otherRoot);
		writeFileSync(join(otherRoot, "a.txt"), "hello\n");
		git(["add", "-A"], otherRoot);
		git(["commit", "-q", "-m", "init"], otherRoot);
		const head = git(["rev-parse", "HEAD"], otherRoot);

		const otherWs: RunWorkspace = {
			layout: "single",
			cwd: otherRoot,
			repos: [
				{
					name: "repo",
					dir: otherRoot,
					sourceKind: "folder",
					url: otherRoot,
					subPath: null,
					connectionId: null,
					head,
					branch: "main",
					services: [],
				},
			],
		};

		writeFileSync(join(otherRoot, "a.txt"), "changed\n");
		const all = (await readScopedChanges(otherWs, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const allScoped = all.scoped as ScopedDiff;
		const res = await revertChanges(
			otherWs,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "a.txt" },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			ctx,
		);
		expect(res).toEqual({
			state: "refused",
			reason: "blocked",
			paths: [],
			block: "borrowed",
		});
	});

	it("directory collision: target state has file d but on disk d is a directory holding an ignored file -> refused with reason linked and the directory and its file still exist", async () => {
		writeFileSync(join(root, "d"), "original file\n");
		git(["add", "d"]);
		git(["commit", "-q", "-m", "add d"]);
		const head = git(["rev-parse", "HEAD"]);
		ws.repos[0]!.head = head;

		rmSync(join(root, "d"));
		mkdirSync(join(root, "d"), { recursive: true });
		writeFileSync(join(root, "d", "ignored.log"), "colliding file\n");

		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const allScoped = all.scoped as ScopedDiff;
		const res = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "d" },
				expect: { d: allScoped.states["d"] as string },
			},
			ctx,
		);
		expect(res).toEqual({
			state: "refused",
			reason: "linked",
			paths: ["d"],
			block: null,
		});
		expect(existsSync(join(root, "d"))).toBe(true);
		expect(existsSync(join(root, "d", "ignored.log"))).toBe(true);
	});

	it("readChangesFile returns {state: ok, contents} for a snapshot commit, and {state: unavailable, reason: no-workspace} for a commit no snapshot reaches (e.g. 40 zeros)", async () => {
		writeFileSync(join(root, "new.txt"), "hello snapshot file\n");
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const allScoped = all.scoped as ScopedDiff;
		const okRes = await readChangesFile(
			ws,
			runId,
			"repo",
			allScoped.to,
			"new.txt",
			[loc],
		);
		expect(okRes).toEqual({
			state: "ok",
			contents: "hello snapshot file\n",
		});

		const zeroRes = await readChangesFile(
			ws,
			runId,
			"repo",
			"0".repeat(40),
			"a.txt",
			[loc],
		);
		expect(zeroRes).toEqual({
			state: "unavailable",
			reason: "no-workspace",
		});
	});

	it("the user's repository gains no refs and its index file bytes are unchanged after snapshots and reverts", async () => {
		const refsBefore = git(["for-each-ref"]);
		const indexFile = git([
			"rev-parse",
			"--path-format=absolute",
			"--git-path",
			"index",
		]);
		const indexBytesBefore = readFileSync(indexFile);

		writeFileSync(join(root, "a.txt"), "modified for ref check\n");
		writeFileSync(join(root, "untracked.txt"), "untracked file\n");
		await snapshotTurn(ws, runId, "start", 1, sig, [loc]);
		await snapshotTurn(ws, runId, "end", 1, sig, [loc]);

		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");

		const allScoped = all.scoped as ScopedDiff;
		await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "untracked.txt" },
				expect: { "untracked.txt": allScoped.states["untracked.txt"] as string },
			},
			ctx,
		);

		const refsAfter = git(["for-each-ref"]);
		const indexBytesAfter = readFileSync(indexFile);

		expect(refsAfter).toBe(refsBefore);
		expect(indexBytesAfter.equals(indexBytesBefore)).toBe(true);
	});

	it("readScopedChanges returns empty repos when ws is null or layout is folder", async () => {
		const nullRes = await readScopedChanges(null, "all", undefined, ctx);
		expect(nullRes).toEqual({ repos: [] });

		const folderWs: RunWorkspace = {
			...ws,
			layout: "folder",
		};
		const folderRes = await readScopedChanges(folderWs, "all", undefined, ctx);
		expect(folderRes).toEqual({ repos: [] });
	});

	it("readScopedChanges with scope uncommitted after a commit inside worktree lists only uncommitted files", async () => {
		writeFileSync(join(root, "committed.txt"), "committed\n");
		git(["add", "committed.txt"]);
		git(["commit", "-q", "-m", "add committed.txt"]);

		writeFileSync(join(root, "uncommitted.txt"), "uncommitted\n");

		const res = await readScopedChanges(ws, "uncommitted", undefined, ctx);
		const repo = res.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error("not ok");

		expect(repo.files.map((f) => f.path)).toEqual(["uncommitted.txt"]);
	});

	it("readScopedChanges with scope outside returns no-snapshot when no turn has ended", async () => {
		await snapshotTurn(ws, runId, "start", 1, sig, [loc]);

		const res = await readScopedChanges(ws, "outside", undefined, ctx);
		const repo = res.repos[0];
		expect(repo).toEqual({
			state: "unavailable",
			repo: "repo",
			reason: "no-snapshot",
		});
	});

	it("readScopedChanges returns state unavailable when repo directory is removed", async () => {
		const missingDir = join(loc, "removed-dir");
		const brokenWs: RunWorkspace = {
			...ws,
			repos: [
				{
					...ws.repos[0]!,
					dir: missingDir,
				},
			],
		};

		const res = await readScopedChanges(brokenWs, "all", undefined, ctx);
		const repo = res.repos[0];
		expect(repo).toEqual({
			state: "unavailable",
			repo: "repo",
			reason: "removed",
		});
	});

	it("snapshotTurn with aborted signal or null ws exits safely without writing refs", async () => {
		await expect(snapshotTurn(null, runId, "start", 1, sig, [loc])).resolves.toBeUndefined();

		const controller = new AbortController();
		controller.abort();
		await snapshotTurn(ws, runId, "start", 99, controller.signal, [loc]);

		const res = await readScopedChanges(ws, "turn", 99, ctx);
		expect(res.repos[0]?.state).toBe("unavailable");
	});

	it("readChangesFile handles unknown repo, unsafe path, absent file, empty file, binary file, and large file", async () => {
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const commit = (all.scoped as ScopedDiff).to;

		// Unknown repo name
		const badRepo = await readChangesFile(ws, runId, "nonexistent", commit, "a.txt", [loc]);
		expect(badRepo).toEqual({ state: "unavailable", reason: "no-workspace" });

		// Unsafe path
		const unsafe = await readChangesFile(ws, runId, "repo", commit, "../unsafe.txt", [loc]);
		expect(unsafe).toEqual({ state: "unavailable", reason: "no-workspace" });

		// Absent path at commit
		const absent = await readChangesFile(ws, runId, "repo", commit, "missing.txt", [loc]);
		expect(absent).toEqual({ state: "unavailable", reason: "absent" });

		// Empty file (size 0)
		writeFileSync(join(root, "empty.txt"), "");
		// "Now" snapshots coalesce for 2 s; a re-read after a write waits that out (hence 30 s).
		await new Promise((r) => setTimeout(r, 2100));
		const allWithEmpty = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allWithEmpty?.state !== "ok") throw new Error("not ok");
		const commitWithEmpty = (allWithEmpty.scoped as ScopedDiff).to;

		const emptyRes = await readChangesFile(ws, runId, "repo", commitWithEmpty, "empty.txt", [loc]);
		expect(emptyRes).toEqual({ state: "ok", contents: "" });

		// Binary file containing NUL byte
		writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
		await new Promise((r) => setTimeout(r, 2100));
		const allWithBinary = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allWithBinary?.state !== "ok") throw new Error("not ok");
		const commitWithBinary = (allWithBinary.scoped as ScopedDiff).to;

		const binRes = await readChangesFile(ws, runId, "repo", commitWithBinary, "binary.bin", [loc]);
		expect(binRes).toEqual({ state: "unavailable", reason: "binary" });

		// Large file > WORKTREE_FILE_MAX_BYTES (512 KB)
		const bigBuf = Buffer.alloc(512 * 1024 + 1, "x");
		writeFileSync(join(root, "big.txt"), bigBuf);
		// Must commit or stage to have git object for cat-file
		git(["add", "big.txt"]);
		git(["commit", "-q", "-m", "add big"]);
		const headCommit = git(["rev-parse", "HEAD"]);
		ws.repos[0]!.head = headCommit;

		await new Promise((r) => setTimeout(r, 2100));
		const allWithBig = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allWithBig?.state !== "ok") throw new Error("not ok");
		const commitWithBig = (allWithBig.scoped as ScopedDiff).to;

		const bigRes = await readChangesFile(ws, runId, "repo", commitWithBig, "big.txt", [loc]);
		expect(bigRes).toEqual({ state: "unavailable", reason: "too-large" });
	}, 30_000);

	it("revertChanges refuses null ws, unknown repo, unknown revert id and unknown turn seq without writing a revert ref", async () => {
		// Null ws
		const nullRes = await revertChanges(
			null,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: "",
				target: { kind: "file", path: "a.txt" },
				expect: {},
			},
			ctx,
		);
		expect(nullRes).toEqual({ state: "refused", reason: "unavailable", paths: [], block: null });

		// Unknown repo
		const badRepoRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "nonexistent",
				scope: "all",
				from: "",
				target: { kind: "file", path: "a.txt" },
				expect: {},
			},
			ctx,
		);
		expect(badRepoRes).toEqual({ state: "refused", reason: "unavailable", paths: [], block: null });

		// Undo of an unknown revert id
		const badUndoRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: "",
				target: { kind: "undo", revertId: "999999" },
				expect: {},
			},
			ctx,
		);
		expect(badUndoRes).toEqual({ state: "refused", reason: "no-snapshot", paths: [], block: null });

		// Turn undo for unknown seq
		const badTurnRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "turn",
				from: "",
				target: { kind: "turn", seq: 999 },
				expect: {},
			},
			ctx,
		);
		expect(badTurnRes).toEqual({ state: "refused", reason: "no-snapshot", paths: [], block: null });

		const store = join(baseDir, "data", "snapshots", runId, "0.git");
		const refs = existsSync(store)
			? git(["--git-dir", store, "for-each-ref", "refs/pl/revert"])
			: "";
		expect(refs).toBe("");
	});

	it("revertChanges refuses a hunk revert on an added file with not-a-hunk", async () => {
		writeFileSync(join(root, "untracked-for-hunk.txt"), "hello new file\n");
		const allAdd = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allAdd?.state !== "ok") throw new Error("not ok");
		const allAddScoped = allAdd.scoped as ScopedDiff;

		const notAHunkRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allAddScoped.from,
				target: {
					kind: "hunk",
					path: "untracked-for-hunk.txt",
					header: "@@ -0,0 +1 @@",
				},
				expect: {
					"untracked-for-hunk.txt": allAddScoped.states["untracked-for-hunk.txt"] as string,
				},
			},
			ctx,
		);
		expect(notAHunkRes).toEqual({
			state: "refused",
			reason: "not-a-hunk",
			paths: ["untracked-for-hunk.txt"],
			block: null,
		});
	});

	it("revertChanges refuses a stale from commit and a hunk header that matches nothing with stale", async () => {
		const staleFromRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: "0".repeat(40),
				target: { kind: "file", path: "a.txt" },
				expect: {},
			},
			ctx,
		);
		expect(staleFromRes).toEqual({
			state: "refused",
			reason: "stale",
			paths: ["a.txt"],
			block: null,
		});

		// Hunk revert whose header matches nothing -> stale
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		const allMod = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allMod?.state !== "ok") throw new Error("not ok");
		const allModScoped = allMod.scoped as ScopedDiff;

		const nonMatchingHunk = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allModScoped.from,
				target: {
					kind: "hunk",
					path: "a.txt",
					header: "@@ -999,0 +999,0 @@ non-existent",
				},
				expect: {
					"a.txt": allModScoped.states["a.txt"] as string,
				},
			},
			ctx,
		);
		expect(nonMatchingHunk).toEqual({
			state: "refused",
			reason: "stale",
			paths: ["a.txt"],
			block: null,
		});
	});

	it("readChangesPatch returns unavailable no-workspace for null workspace, unknown repo, unsafe path, unreachable from commit, unreachable to commit, and omitted roots", async () => {
		const q = { repo: "repo", from: "0".repeat(40), to: "0".repeat(40), path: "a.txt" };
		const nullRes = await readChangesPatch(null, runId, q, [loc]);
		expect(nullRes).toEqual({ state: "unavailable", reason: "no-workspace" });

		const unknownRepoRes = await readChangesPatch(
			ws,
			runId,
			{ ...q, repo: "unknown" },
			[loc],
		);
		expect(unknownRepoRes).toEqual({ state: "unavailable", reason: "no-workspace" });

		const unsafeRes = await readChangesPatch(
			ws,
			runId,
			{ ...q, path: "../secret.txt" },
			[loc],
		);
		expect(unsafeRes).toEqual({ state: "unavailable", reason: "no-workspace" });

		const unreachableFrom = await readChangesPatch(
			ws,
			runId,
			{ repo: "repo", from: "0".repeat(40), to: "0".repeat(40), path: "a.txt" },
			[loc],
		);
		expect(unreachableFrom).toEqual({ state: "unavailable", reason: "no-workspace" });

		writeFileSync(join(root, "a.txt"), "modified\n");
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const allScoped = all.scoped as ScopedDiff;

		const unreachableTo = await readChangesPatch(
			ws,
			runId,
			{ repo: "repo", from: allScoped.from, to: "0".repeat(40), path: "a.txt" },
			[loc],
		);
		expect(unreachableTo).toEqual({ state: "unavailable", reason: "no-workspace" });

		const omittedRoots = await readChangesPatch(ws, runId, {
			repo: "repo",
			from: allScoped.from,
			to: allScoped.to,
			path: "a.txt",
		});
		expect(omittedRoots).toEqual({ state: "unavailable", reason: "no-workspace" });
	});

	it("readChangesPatch returns ok with diff text and state for modified file, and marks deleted file absent", async () => {
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		const allMod = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allMod?.state !== "ok") throw new Error("not ok");
		const modScoped = allMod.scoped as ScopedDiff;

		const modRes = await readChangesPatch(
			ws,
			runId,
			{
				repo: "repo",
				from: modScoped.from,
				to: modScoped.to,
				path: "a.txt",
			},
			[loc],
		);
		expect(modRes.state).toBe("ok");
		if (modRes.state !== "ok") throw new Error("expected ok patch");
		expect(modRes.at).toBe(modScoped.states["a.txt"]);
		expect(modRes.patch).toContain("-one\n+ONE\n");

		rmSync(join(root, "a.txt"));
		// Now snapshots coalesce for 2 s; a re-read after a write waits that out.
		await new Promise((r) => setTimeout(r, 2100));
		const allDel = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (allDel?.state !== "ok") throw new Error("not ok");
		const delScoped = allDel.scoped as ScopedDiff;

		const delRes = await readChangesPatch(
			ws,
			runId,
			{
				repo: "repo",
				from: modScoped.from,
				to: delScoped.to,
				path: "a.txt",
			},
			[loc],
		);
		expect(delRes.state).toBe("ok");
		if (delRes.state !== "ok") throw new Error("expected ok patch");
		expect(delRes.at).toBe("absent");
		expect(delRes.patch).toContain("-one\n");
	}, 30_000);

	it("readScopedChanges returns too-large when total diff exceeds maximum bytes", async () => {
		for (let i = 0; i < 5; i++) {
			writeFileSync(join(root, `big${i}.txt`), `${"x".repeat(450 * 1024)}\n`);
		}

		const allRes = await readScopedChanges(ws, "all", undefined, ctx);
		const repo = allRes.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error("not ok");
		expect(repo.patch).toBeNull();
		expect(repo.omitted).toBe("too-large");
	});

	it("readChangesPatch returns too-large when file diff exceeds maximum bytes", async () => {
		const chunkA = `${"a".repeat(100)}\n`;
		const chunkB = `${"b".repeat(100)}\n`;
		writeFileSync(join(root, "huge.txt"), chunkA.repeat(25_000));
		git(["add", "huge.txt"]);
		git(["commit", "-q", "-m", "huge A"]);
		const fromCommit = git(["rev-parse", "HEAD"]);

		writeFileSync(join(root, "huge.txt"), chunkB.repeat(25_000));
		git(["add", "huge.txt"]);
		git(["commit", "-q", "-m", "huge B"]);
		const toCommit = git(["rev-parse", "HEAD"]);
		ws.repos[0]!.head = toCommit;

		const patchRes = await readChangesPatch(
			ws,
			runId,
			{
				repo: "repo",
				from: fromCommit,
				to: toCommit,
				path: "huge.txt",
			},
			[loc],
		);
		expect(patchRes).toEqual({
			state: "unavailable",
			reason: "too-large",
		});
	});

	it("readScopedChanges with patch none omits patch and states, returning omitted per-file", async () => {
		writeFileSync(join(root, "a.txt"), "modified\n");
		const res = await readScopedChanges(ws, "all", undefined, ctx, { patch: "none" });
		const repo = res.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error("not ok");

		expect(repo.patch).toBeNull();
		expect(repo.omitted).toBe("per-file");
		const scoped = repo.scoped as ScopedDiff;
		expect(scoped.states).toEqual({});
	});

	it("readChangesFile handles null workspace and omitted roots", async () => {
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const commit = (all.scoped as ScopedDiff).to;

		const nullRes = await readChangesFile(
			null,
			runId,
			"repo",
			commit,
			"a.txt",
			[loc],
		);
		expect(nullRes).toEqual({ state: "unavailable", reason: "no-workspace" });

		const omittedRoots = await readChangesFile(
			ws,
			runId,
			"repo",
			commit,
			"a.txt",
		);
		expect(omittedRoots).toEqual({ state: "unavailable", reason: "no-workspace" });
	});

	it("reachable uses ref tip ancestry and caches reached commit results", async () => {
		const head = ws.repos[0]!.head;
		await snapshotTurn(ws, runId, "start", 1, sig, [loc]);

		const first = await readChangesFile(ws, runId, "repo", head, "a.txt", [loc]);
		expect(first).toEqual({
			state: "ok",
			contents: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		});

		const second = await readChangesFile(ws, runId, "repo", head, "a.txt", [loc]);
		expect(second).toEqual({
			state: "ok",
			contents: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		});
	});

	it("scope turn without turn identifier picks latest turn snapshot, and live turn resolves to now", async () => {
		const noTurn = await readScopedChanges(ws, "turn", undefined, ctx);
		expect(noTurn.repos[0]).toEqual({
			state: "unavailable",
			repo: "repo",
			reason: "no-snapshot",
		});

		await snapshotTurn(ws, runId, "start", 7, sig, [loc]);
		const liveRes = await readScopedChanges(ws, "turn", undefined, ctx);
		const repo = liveRes.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error("not ok");

		const scoped = repo.scoped as ScopedDiff;
		expect(scoped.turn).toBe(7);
		expect(scoped.live).toBe(true);
	});

	it("outside scope when turn ended but no files changed outside produces empty pathspec", async () => {
		await snapshotTurn(ws, runId, "start", 1, sig, [loc]);
		writeFileSync(join(root, "a.txt"), "turn one content\n");
		await snapshotTurn(ws, runId, "end", 1, sig, [loc]);
		await snapshotTurn(ws, runId, "start", 2, sig, [loc]);

		const res = await readScopedChanges(ws, "outside", undefined, ctx);
		const repo = res.repos[0];
		expect(repo?.state).toBe("ok");
		if (repo?.state !== "ok") throw new Error("not ok");

		expect(repo.files).toEqual([]);
		const scoped = repo.scoped as ScopedDiff;
		expect(scoped.outside).toEqual([]);
	});

	it("readScopedChanges returns unavailable not-a-workspace when core.sparseCheckout is configured", async () => {
		git(["config", "core.sparseCheckout", "true"]);
		const res = await readScopedChanges(ws, "all", undefined, ctx);
		expect(res.repos[0]).toEqual({
			state: "unavailable",
			repo: "repo",
			reason: "not-a-workspace",
		});
	});

	it("revertChanges refuses with blocked folder when workspace layout is folder", async () => {
		const folderWs: RunWorkspace = {
			...ws,
			layout: "folder",
		};
		const res = await revertChanges(
			folderWs,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: ws.repos[0]!.head,
				target: { kind: "file", path: "a.txt" },
				expect: {},
			},
			ctx,
		);
		expect(res).toEqual({
			state: "refused",
			reason: "blocked",
			paths: [],
			block: "folder",
		});
	});

	it("revertChanges refuses with no-snapshot when target path has no changes or turn changed no files", async () => {
		await snapshotTurn(ws, runId, "start", 5, sig, [loc]);
		await snapshotTurn(ws, runId, "end", 5, sig, [loc]);

		const emptyTurnRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "turn",
				from: "",
				target: { kind: "turn", seq: 5 },
				expect: {},
			},
			ctx,
		);
		expect(emptyTurnRes).toEqual({
			state: "refused",
			reason: "no-snapshot",
			paths: [],
			block: null,
		});

		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const allScoped = all.scoped as ScopedDiff;

		const unchangedFileRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "a.txt" },
				expect: {},
			},
			ctx,
		);
		expect(unchangedFileRes).toEqual({
			state: "refused",
			reason: "no-snapshot",
			paths: [],
			block: null,
		});
	});

	it("revertChanges refuses with linked when target path is skipped link", async () => {
		const outside = join(baseDir, "outside-linked");
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "secret.txt"), "SECRET\n");
		linkSync(join(outside, "secret.txt"), join(root, "hard.txt"));

		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const allScoped = all.scoped as ScopedDiff;

		const res = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "hard.txt" },
				expect: {},
			},
			ctx,
		);
		expect(res).toEqual({
			state: "refused",
			reason: "linked",
			paths: ["hard.txt"],
			block: null,
		});
	});

	it("revertChanges refuses with not-a-hunk for invalid regular mode or mismatched file mode, and stale for omitted expect or missing diff hunks", async () => {
		writeFileSync(
			join(root, "a.txt"),
			"ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		const all = (await readScopedChanges(ws, "all", undefined, ctx)).repos[0];
		if (all?.state !== "ok") throw new Error("not ok");
		const allScoped = all.scoped as ScopedDiff;

		const invalidModeRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "hunk", path: "a.txt", header: "@@ -1,4 +1,4 @@" },
				expect: { "a.txt": "invalid-mode-string" },
			},
			ctx,
		);
		expect(invalidModeRes).toEqual({
			state: "refused",
			reason: "not-a-hunk",
			paths: ["a.txt"],
			block: null,
		});

		const mismatchedModeRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "hunk", path: "a.txt", header: "@@ -1,4 +1,4 @@" },
				expect: {
					"a.txt": "100755 0123456789abcdef0123456789abcdef01234567",
				},
			},
			ctx,
		);
		expect(mismatchedModeRes).toEqual({
			state: "refused",
			reason: "not-a-hunk",
			paths: ["a.txt"],
			block: null,
		});

		const omittedExpectRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "file", path: "a.txt" },
				expect: {},
			},
			ctx,
		);
		expect(omittedExpectRes).toEqual({
			state: "refused",
			reason: "stale",
			paths: ["a.txt"],
			block: null,
		});

		writeFileSync(
			join(root, "a.txt"),
			"one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
		);
		// Coalesce wait so now commit has identical text to original from commit
		await new Promise((r) => setTimeout(r, 2100));
		const emptyDiffRes = await revertChanges(
			ws,
			{
				id: runId,
				repo: "repo",
				scope: "all",
				from: allScoped.from,
				target: { kind: "hunk", path: "a.txt", header: "@@ -1,4 +1,4 @@" },
				expect: { "a.txt": allScoped.states["a.txt"] as string },
			},
			ctx,
		);
		expect(emptyDiffRes).toEqual({
			state: "refused",
			reason: "stale",
			paths: ["a.txt"],
			block: null,
		});
	}, 30_000);

	it("readScopedChanges with patch none evicts oldest between cache entries when capacity is exceeded and reloads cached summary from store file", async () => {
		const runId2 = "22222222-2222-4333-8444-555555555555";
		const root2 = join(loc, `pl-${runId2}`);
		mkdirSync(root2, { recursive: true });
		git(["init", "-q", "-b", "main"], root2);
		git(["config", "core.autocrlf", "false"], root2);
		writeFileSync(join(root2, "b.txt"), "hello\n");
		git(["add", "-A"], root2);
		git(["commit", "-q", "-m", "init"], root2);
		const head2 = git(["rev-parse", "HEAD"], root2);

		const ws2: RunWorkspace = {
			layout: "single",
			cwd: root2,
			repos: [
				{
					name: "repo",
					dir: root2,
					sourceKind: "folder",
					url: root2,
					subPath: null,
					connectionId: null,
					head: head2,
					branch: "main",
					services: [],
				},
			],
		};
		const ctx2 = { runId: runId2, running: false, canWrite: true, roots: [loc] };

		const resInit = await readScopedChanges(ws2, "all", undefined, ctx2, { patch: "none" });

		for (let i = 0; i < 33; i++) {
			writeFileSync(join(root, "seq.txt"), `step-${i}\n`);
			git(["add", "seq.txt"]);
			git(["commit", "-q", "-m", `step ${i}`]);
			await readScopedChanges(ws, "all", undefined, ctx, { patch: "none" });
		}

		const finalRes = await readScopedChanges(ws, "all", undefined, ctx, { patch: "none" });
		const finalRepo = finalRes.repos[0];
		expect(finalRepo?.state).toBe("ok");
		if (finalRepo?.state !== "ok") throw new Error("not ok");
		expect(finalRepo.omitted).toBe("per-file");

		const cacheFile = join(baseDir, "data", "snapshots", runId, "0.git", "pl-between.json");
		expect(existsSync(cacheFile)).toBe(true);

		const resReload = await readScopedChanges(ws2, "all", undefined, ctx2, { patch: "none" });
		const reloadRepo = resReload.repos[0];
		expect(reloadRepo?.state).toBe("ok");
		if (reloadRepo?.state !== "ok") throw new Error("not ok");
		const initRepo = resInit.repos[0];
		if (initRepo?.state !== "ok") throw new Error("not ok");
		expect(reloadRepo.files).toEqual(initRepo.files);
	}, 60_000);
});
