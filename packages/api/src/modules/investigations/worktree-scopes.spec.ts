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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readChangesFile,
	readScopedChanges,
	revertChanges,
	snapshotTurn,
} from "./worktree-scopes.js";

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
		});
		expect(existsSync(join(root, "new.txt"))).toBe(false);
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
});
