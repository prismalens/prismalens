// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Real-git tests for edit-and-rewind's file operations (#1193): rewind, undo, restore of an
 * interrupted operation, and the write-time checks, on a temp repo with turn snapshots.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REWIND_PATHS_MAX, type RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	openStore,
	statesAt,
	storeGit,
	takeSnapshot,
	withStoreLock,
} from "./worktree-snapshots.js";
import {
	interruptedWritten,
	markStoreOp,
	type NamedPaths,
	previewRestoreFiles,
	previewRewindFiles,
	type RepoOpResult,
	restoreFiles,
	rewindFiles,
	type ScopeContext,
	snapshotNow,
	snapshotTurn,
	storeOps,
	undoRewindFiles,
	writeStates,
} from "./worktree-scopes.js";

vi.setConfig({ testTimeout: 50_000 }); // slowest test 16448 ms; 3x, rounded up to the second, at least 5 s (#1154)

const A0 = "one\ntwo\nthree\n";
const A1 = "one\nTWO by the agent\nthree\n";
const A2 = "one\nTWO again, by the replacement turn\nthree\n";
const NEW = "written by the agent\n";
const R0 = "# repo\n";
const R1 = "# repo\n\nEdited by hand.\n";
const MESSAGE_SEQ = 1;
const TURN_SEQ = 2;

/** A directory link a test can make: a junction needs no privilege on Windows. */
const dirLink = (target: string, at: string) =>
	symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");

describe("rewind, undo and restore of a thread's files (#1193)", () => {
	let baseDir: string;
	let loc: string;
	let root: string;
	let runId: string;
	let ws: RunWorkspace;
	let ctx: ScopeContext;
	const sig = new AbortController().signal;

	const git = (args: string[], cwd = root) =>
		execFileSync("git", ["-c", "user.email=t@t.local", "-c", "user.name=T", ...args], {
			cwd,
			encoding: "utf8",
		}).trim();
	const read = (p: string) =>
		existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null;
	const store = () => openStore(runId, 0, ws.repos[0] as RunWorkspace["repos"][number], [loc]);
	const turn = async (seq: number, work: () => void) => {
		await snapshotTurn(ws, runId, "start", seq, sig, [loc]);
		work();
		await snapshotTurn(ws, runId, "end", seq, sig, [loc]);
	};
	const okPreview = async (named: readonly NamedPaths[]) => {
		const [p] = await previewRewindFiles(ws, MESSAGE_SEQ, named, ctx);
		if (p?.state !== "ok") throw new Error(`expected an ok preview, got ${JSON.stringify(p)}`);
		return p;
	};
	const done = (r: RepoOpResult) => {
		if (r.state !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
		return r;
	};
	/** The agent's turn: it edits a.txt and creates agent.txt, naming both in its tool calls. */
	const agentTurn = () =>
		turn(TURN_SEQ, () => {
			writeFileSync(join(root, "a.txt"), A1);
			writeFileSync(join(root, "agent.txt"), NEW);
		});
	const NAMED: NamedPaths[] = [{ seq: TURN_SEQ + 1, paths: ["a.txt", "agent.txt"] }];
	const rewind = async (o: { include?: string[] } = {}) => {
		const p = await okPreview(NAMED);
		const op = randomUUID();
		const r = await rewindFiles(ws, "repo", ctx, {
			op,
			rewindId: randomUUID(),
			fromSeq: MESSAGE_SEQ,
			named: NAMED,
			include: new Set(o.include ?? []),
			expect: { head: p.head, tree: p.tree },
		});
		return { op, r };
	};

	beforeEach(() => {
		baseDir = mkdtempSync(join(tmpdir(), "pl-rewind-spec-"));
		process.env.PRISMALENS_WORKSPACE_DIR = join(baseDir, "data");
		runId = "11111111-2222-4333-8444-666666666666";
		loc = join(baseDir, "wt");
		root = join(loc, `pl-${runId}`);
		mkdirSync(root, { recursive: true });
		git(["init", "-q", "-b", "main"]);
		git(["config", "core.autocrlf", "false"]);
		writeFileSync(join(root, "a.txt"), A0);
		writeFileSync(join(root, "README.md"), R0);
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "init"]);
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
					head: git(["rev-parse", "HEAD"]),
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

	it("preview lists the agent's two files to set back, keeps the user's README edit as yours, counts 0 commits, and writes nothing", async () => {
		await agentTurn();
		writeFileSync(join(root, "README.md"), R1);

		const p = await okPreview(NAMED);

		expect(p.revert.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
			{ path: "a.txt", status: "modified" },
			{ path: "agent.txt", status: "added" },
		]);
		expect(p.kept).toEqual([{ path: "README.md", why: "yours" }]);
		expect(p.duringTurn).toEqual([]);
		expect(p.commits).toBe(0);
		expect([read("a.txt"), read("agent.txt"), read("README.md")]).toEqual([A1, NEW, R1]);
	});

	it("rewind sets a.txt back to its content at the message, deletes the agent's new file, and keeps the README the user saved since", async () => {
		await agentTurn();
		writeFileSync(join(root, "README.md"), R1);

		const { op, r } = await rewind();

		const d = done(r);
		expect(d.op).toBe(op);
		expect(d.reverted.toSorted()).toEqual(["a.txt", "agent.txt"]);
		expect(d.kept).toEqual([{ path: "README.md", why: "yours" }]);
		expect([read("a.txt"), read("agent.txt"), read("README.md")]).toEqual([A0, null, R1]);
	});

	it("a path a turn changed but no tool call named is kept as during-turn, and set back only when included", async () => {
		await turn(TURN_SEQ, () => {
			writeFileSync(join(root, "a.txt"), A1);
			writeFileSync(join(root, "build.log.txt"), "generated\n");
		});
		const named: NamedPaths[] = [{ seq: TURN_SEQ, paths: [join(root, "a.txt")] }];
		const p = await okPreview(named);
		expect(p.duringTurn).toEqual(["build.log.txt"]);
		expect(p.revert).toEqual([{ path: "a.txt", status: "modified" }]);

		const kept = done(
			await rewindFiles(ws, "repo", ctx, {
				op: randomUUID(),
				rewindId: randomUUID(),
				fromSeq: MESSAGE_SEQ,
				named,
				include: new Set(),
				expect: { head: p.head, tree: p.tree },
			}),
		);
		expect(kept.reverted).toEqual(["a.txt"]);
		expect(kept.kept).toEqual([{ path: "build.log.txt", why: "during-turn" }]);
		expect(read("build.log.txt")).toBe("generated\n");

		const again = await okPreview(named);
		expect(again.duringTurn).toEqual(["build.log.txt"]);
		const included = done(
			await rewindFiles(ws, "repo", ctx, {
				op: randomUUID(),
				rewindId: randomUUID(),
				fromSeq: MESSAGE_SEQ,
				named,
				include: new Set(["build.log.txt"]),
				expect: { head: again.head, tree: again.tree },
			}),
		);
		expect(included.reverted).toEqual(["build.log.txt"]);
		expect(read("build.log.txt")).toBe(null);
	});

	it("undo restores every file the rewind wrote to its pre-rewind bytes exactly (LF)", async () => {
		await agentTurn();
		writeFileSync(join(root, "README.md"), R1);
		const before = ["a.txt", "agent.txt", "README.md"].map((p) => readFileSync(join(root, p)));
		const { op } = await rewind();

		const u = done(
			await undoRewindFiles(ws, "repo", ctx, {
				op: randomUUID(),
				of: op,
				rewindId: randomUUID(),
				afterSeq: 100,
			}),
		);

		expect(u.reverted.toSorted()).toEqual(["a.txt", "agent.txt"]);
		expect(u.kept).toEqual([]);
		const after = ["a.txt", "agent.txt", "README.md"].map((p) => readFileSync(join(root, p)));
		expect(after.map((b, i) => b.equals(before[i] as Buffer))).toEqual([true, true, true]);
	});

	it("undo after a replacement turn rewrote a.txt still restores the rewind's backup (R5)", async () => {
		await agentTurn();
		const { op } = await rewind();
		await turn(101, () => writeFileSync(join(root, "a.txt"), A2));

		const u = done(
			await undoRewindFiles(ws, "repo", ctx, {
				op: randomUUID(),
				of: op,
				rewindId: randomUUID(),
				afterSeq: 100,
			}),
		);

		expect(u.reverted.toSorted()).toEqual(["a.txt", "agent.txt"]);
		expect([read("a.txt"), read("agent.txt")]).toEqual([A1, NEW]);
	});

	it("undo keeps a file the user saved after the rewind as yours and leaves its bytes", async () => {
		await agentTurn();
		const { op } = await rewind();
		writeFileSync(join(root, "a.txt"), "the user's own fix\n");

		const u = done(
			await undoRewindFiles(ws, "repo", ctx, {
				op: randomUUID(),
				of: op,
				rewindId: randomUUID(),
				afterSeq: 100,
			}),
		);

		expect(u.reverted).toEqual(["agent.txt"]);
		expect(u.kept).toEqual([{ path: "a.txt", why: "yours" }]);
		expect(read("a.txt")).toBe("the user's own fix\n");
	});

	it("a stale preview is refused with stale before any write, leaving only the meta and backup refs", async () => {
		await agentTurn();
		const p = await okPreview(NAMED);
		writeFileSync(join(root, "README.md"), R1);
		const op = randomUUID();

		const r = await rewindFiles(ws, "repo", ctx, {
			op,
			rewindId: randomUUID(),
			fromSeq: MESSAGE_SEQ,
			named: NAMED,
			include: new Set(),
			expect: { head: p.head, tree: p.tree },
		});

		expect(r).toEqual({ state: "refused", repo: "repo", reason: "stale", paths: [] });
		expect([read("a.txt"), read("agent.txt")]).toEqual([A1, NEW]);
		const ops = await storeOps((await store()).gitDir);
		expect([...(ops.get(op)?.refs ?? [])].toSorted()).toEqual(["backup", "meta"]);
	});

	it("an operation interrupted after its meta ref is listed by its store with kind, rewind id and repo, and names no written path", async () => {
		await agentTurn();
		const p = await okPreview(NAMED);
		writeFileSync(join(root, "README.md"), R1);
		const op = randomUUID();
		const rewindId = randomUUID();
		await rewindFiles(ws, "repo", ctx, {
			op,
			rewindId,
			fromSeq: MESSAGE_SEQ,
			named: NAMED,
			include: new Set(),
			expect: { head: p.head, tree: p.tree },
		});
		const { gitDir } = await store();

		const found = (await storeOps(gitDir)).get(op);
		expect(found?.meta).toEqual({ kind: "rewind", rewindId, thread: runId, repo: "repo" });
		await markStoreOp(gitDir, op, "interrupted");
		expect([...((await storeOps(gitDir)).get(op)?.refs ?? [])].toSorted()).toEqual([
			"backup",
			"interrupted",
			"meta",
		]);
		expect(await interruptedWritten(gitDir, op, await snapshotNow(ws, "repo", ctx))).toEqual([]);
	});

	it("an operation interrupted mid-write names the paths it may have written, and Restore puts their backup back", async () => {
		await agentTurn();
		const { op } = await rewind();
		const { gitDir } = await store();
		// The crash point: target written, no receipt or after.
		await storeGit(gitDir, ["update-ref", "-d", `refs/pl/op/${op}/receipt`]);
		await storeGit(gitDir, ["update-ref", "-d", `refs/pl/op/${op}/after`]);
		expect([...((await storeOps(gitDir)).get(op)?.refs ?? [])].toSorted()).toEqual([
			"backup",
			"meta",
			"target",
		]);

		const written = await interruptedWritten(gitDir, op, await snapshotNow(ws, "repo", ctx));
		expect(written.toSorted()).toEqual(["a.txt", "agent.txt"]);

		const plan = await previewRestoreFiles(ws, "repo", ctx, op);
		if (typeof plan === "string") throw new Error(`expected a plan, got ${plan}`);
		expect(plan.overwrite.toSorted()).toEqual(["a.txt", "agent.txt"]);
		expect([plan.created, plan.damaged]).toEqual([[], []]);
		const r = done(
			await restoreFiles(ws, "repo", ctx, {
				op: randomUUID(),
				of: op,
				expect: { head: plan.head, tree: plan.tree },
				include: new Set(),
			}),
		);
		expect(r.reverted.toSorted()).toEqual(["a.txt", "agent.txt"]);
		expect(r.kept).toEqual([]);
		expect([read("a.txt"), read("agent.txt")]).toEqual([A1, NEW]);
	});

	it("Restore lists a file edited since the interruption as damaged and leaves it unless ticked", async () => {
		await agentTurn();
		const { op } = await rewind();
		writeFileSync(join(root, "a.txt"), "edited after the crash\n");

		const plan = await previewRestoreFiles(ws, "repo", ctx, op);
		if (typeof plan === "string") throw new Error(`expected a plan, got ${plan}`);
		expect([plan.overwrite, plan.damaged]).toEqual([["agent.txt"], ["a.txt"]]);
		const r = done(
			await restoreFiles(ws, "repo", ctx, {
				op: randomUUID(),
				of: op,
				expect: { head: plan.head, tree: plan.tree },
				include: new Set(),
			}),
		);

		expect(r.reverted).toEqual(["agent.txt"]);
		expect(r.kept).toEqual([{ path: "a.txt", why: "damaged" }]);
		expect([read("a.txt"), read("agent.txt")]).toEqual(["edited after the crash\n", NEW]);
	});

	it("a path whose attributes set a filter or ident is kept as filtered and never written", async () => {
		writeFileSync(join(root, ".gitattributes"), "f.txt filter=pl-none\ni.txt ident\n");
		writeFileSync(join(root, "f.txt"), "f0\n");
		writeFileSync(join(root, "i.txt"), "i0\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "attributes"]);
		ws.repos[0] = { ...(ws.repos[0] as RunWorkspace["repos"][number]), head: git(["rev-parse", "HEAD"]) };
		const named: NamedPaths[] = [{ seq: TURN_SEQ, paths: ["a.txt", "f.txt", "i.txt"] }];
		await turn(TURN_SEQ, () => {
			writeFileSync(join(root, "a.txt"), A1);
			writeFileSync(join(root, "f.txt"), "f1\n");
			writeFileSync(join(root, "i.txt"), "i1\n");
		});
		const p = await okPreview(named);

		const r = done(
			await rewindFiles(ws, "repo", ctx, {
				op: randomUUID(),
				rewindId: randomUUID(),
				fromSeq: MESSAGE_SEQ,
				named,
				include: new Set(),
				expect: { head: p.head, tree: p.tree },
			}),
		);

		expect(r.reverted).toEqual(["a.txt"]);
		expect(r.kept.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
			{ path: "f.txt", why: "filtered" },
			{ path: "i.txt", why: "filtered" },
		]);
		expect([read("a.txt"), read("f.txt"), read("i.txt")]).toEqual([A0, "f1\n", "i1\n"]);
	});

	it("a file saved after the backup is kept as changed-while-rewinding and not overwritten", async () => {
		await agentTurn();
		const s = await store();
		const result = await withStoreLock(s.gitDir, async () => {
			const backup = await takeSnapshot(s);
			const states = await statesAt(s, backup.commit, ["a.txt"]);
			const target = await statesAt(s, ws.repos[0]?.head as string, ["a.txt"]);
			writeFileSync(join(root, "a.txt"), "saved during the rewind\n");
			return writeStates(s, { base: backup.commit, targets: target, backup: states });
		});

		expect(result).toEqual({
			receipt: [],
			kept: [{ path: "a.txt", why: "changed-while-rewinding" }],
			linked: null,
		});
		expect(read("a.txt")).toBe("saved during the rewind\n");
	});

	it("a folder replaced by a link after the backup stops the writes, sets back what was written, and writes nothing through the link (R17)", async () => {
		mkdirSync(join(root, "sub"));
		writeFileSync(join(root, "sub", "f.txt"), "s0\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "sub"]);
		const outside = join(baseDir, "outside");
		mkdirSync(outside);
		writeFileSync(join(outside, "f.txt"), "OUTSIDE\n");
		writeFileSync(join(root, "a.txt"), A1);
		const s = await store();
		const result = await withStoreLock(s.gitDir, async () => {
			const backup = await takeSnapshot(s);
			const paths = ["a.txt", "sub/f.txt"];
			const states = await statesAt(s, backup.commit, paths);
			const a0 = (await statesAt(s, git(["rev-parse", "HEAD"]), ["a.txt"])).get("a.txt") as string;
			const target = new Map(paths.map((p) => [p, a0]));
			rmSync(join(root, "sub"), { recursive: true });
			dirLink(outside, join(root, "sub"));
			return writeStates(s, { base: backup.commit, targets: target, backup: states });
		});

		expect(result).toEqual({ receipt: [], kept: [], linked: "sub/f.txt" });
		expect(read("a.txt")).toBe(A1);
		expect(readFileSync(join(outside, "f.txt"), "utf8")).toBe("OUTSIDE\n");
	});

	it("a changed path under a folder the user replaced by a link makes the preview unavailable and refuses the rewind as linked, writing nothing (R17)", async () => {
		mkdirSync(join(root, "sub"));
		writeFileSync(join(root, "sub", "f.txt"), "s0\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "sub"]);
		ws.repos[0] = { ...(ws.repos[0] as RunWorkspace["repos"][number]), head: git(["rev-parse", "HEAD"]) };
		const named: NamedPaths[] = [{ seq: TURN_SEQ, paths: ["a.txt", "sub/f.txt"] }];
		await turn(TURN_SEQ, () => {
			writeFileSync(join(root, "a.txt"), A1);
			writeFileSync(join(root, "sub", "f.txt"), "s1\n");
		});
		const outside = join(baseDir, "outside");
		mkdirSync(outside);
		writeFileSync(join(outside, "f.txt"), "OUTSIDE\n");
		rmSync(join(root, "sub"), { recursive: true });
		dirLink(outside, join(root, "sub"));
		const [preview] = await previewRewindFiles(ws, MESSAGE_SEQ, named, ctx);
		expect(preview).toEqual({ repo: "repo", state: "unavailable", reason: "linked" });

		const s = await store();
		const now = await takeSnapshot(s, { ref: "refs/pl/test/now" });
		const tree = (await storeGit(s.gitDir, ["rev-parse", `${now.commit}^{tree}`])).trim();
		const r = await rewindFiles(ws, "repo", ctx, {
			op: randomUUID(),
			rewindId: randomUUID(),
			fromSeq: MESSAGE_SEQ,
			named,
			include: new Set(),
			expect: { head: now.head, tree },
		});

		expect(r).toEqual({ state: "refused", repo: "repo", reason: "linked", paths: [] });
		expect(readFileSync(join(outside, "f.txt"), "utf8")).toBe("OUTSIDE\n");
		expect(read("a.txt")).toBe(A1);
	});

	it(`preview caps revert and duringTurn at REWIND_PATHS_MAX (${REWIND_PATHS_MAX}) paths each`, async () => {
		const names = Array.from({ length: REWIND_PATHS_MAX + 1 }, (_, i) => `n/f${String(i).padStart(3, "0")}.txt`);
		const unnamed = names.map((n) => n.replace("n/", "u/"));
		mkdirSync(join(root, "n"));
		mkdirSync(join(root, "u"));
		await turn(TURN_SEQ, () => {
			for (const n of [...names, ...unnamed]) writeFileSync(join(root, n), "x\n");
		});

		const p = await okPreview([{ seq: TURN_SEQ, paths: names }]);

		expect(p.revert.map((r) => r.path)).toEqual(names.slice(0, REWIND_PATHS_MAX));
		expect(p.duringTurn).toEqual(unnamed.slice(0, REWIND_PATHS_MAX));
	});
});
