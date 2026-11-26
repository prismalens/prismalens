// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * RewindService on the real app (#1193): a project thread played by fake session `rewind`
 * (turn 1 sets retries to 2, message 2 sets retries to 3, then a hand edit to README.md).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CanonicalEvent,
	type RewindPreview,
	type RunWorkspace,
	RunWorkspaceSchema,
} from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eventually, ScenarioApp } from "../../../test/scenarios/support/scenario-app.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { restoreFiles, rewindFiles, storeOps, undoRewindFiles } from "../investigations/worktree-scopes.js";
import { snapshotStores, storeGit } from "../investigations/worktree-snapshots.js";
import { ToolAsksService } from "../investigations/tool-asks.service.js";
import { RewindService } from "./rewind.service.js";

/** Runs before each lstat the code under test makes, so a test can act at a check. */
const fsHooks = vi.hoisted(() => ({ lstat: null as ((path: string) => void) | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	const lstat = (...a: Parameters<typeof fs.lstat>) => {
		fsHooks.lstat?.(String(a[0]));
		return fs.lstat(...a);
	};
	return { ...fs, lstat };
});
vi.mock("../investigations/worktree-scopes.js", async (importOriginal) => {
	const m = await importOriginal<typeof import("../investigations/worktree-scopes.js")>();
	return {
		...m,
		rewindFiles: vi.fn(m.rewindFiles),
		undoRewindFiles: vi.fn(m.undoRewindFiles),
		restoreFiles: vi.fn(m.restoreFiles),
	};
});
const actual = await vi.importActual<typeof import("../investigations/worktree-scopes.js")>(
	"../investigations/worktree-scopes.js",
);

vi.setConfig({ testTimeout: 30_000 }); // slowest test 9903 ms; 3x, rounded up to the second, at least 5 s (#1154)

const pl = new ScenarioApp();
const source = join(pl.workspace, "shop");
const APP_V1 = "line 1\nline 2\ntimeout = 5\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 1\n";
const APP_TURN_1 = APP_V1.replace("retries = 1", "retries = 2");
const APP_TURN_2 = APP_V1.replace("retries = 1", "retries = 3");
const HAND_EDIT = "# shop\n\nEdited by hand.\n";
const MESSAGE_2 = "Set the retries to 3";
let projectId = "";

interface Run {
	status: string;
	workspace: { cwd: string } | null;
}

const live = (s: string) => ["pending", "running", "queued"].includes(s);
const idle = (id: string, what: string) =>
	eventually(
		() => pl.api<Run>(`/investigations/${id}`),
		(i) => !live(i.status),
		what,
		30_000,
	);
/** The session columns a rewind moves and an undo puts back. */
const sessionsOf = async (id: string) =>
	(await pl.prisma()).investigation.findUniqueOrThrow({
		where: { id },
		select: { acpSessionId: true, agentSessions: true },
	});
const rewinds = () => pl.resolve<RewindService>(RewindService) as RewindService;

/** Every visible event of a thread, oldest first, through the public reader. */
async function visible(id: string): Promise<CanonicalEvent[]> {
	const all: CanonicalEvent[] = [];
	let cursor: number | null = null;
	do {
		const page: { events: CanonicalEvent[]; nextCursor?: number | null } = await pl.api(
			`/investigations/${id}/events?limit=200${cursor === null ? "" : `&cursor=${cursor}`}`,
		);
		all.push(...page.events);
		cursor = page.nextCursor ?? null;
	} while (cursor !== null);
	return all;
}

const labelOf = (e: CanonicalEvent) => `${"branchId" in e ? e.branchId : "report"} ${e.seq} ${e.kind}`;

const seqOf = async (id: string, text: string) => {
	const e = (await visible(id)).find((x) => x.kind === "operator_message" && x.text === text);
	if (!e) throw new Error(`no sent message "${text}" in ${id}`);
	return e.seq;
};

const read = (cwd: string, p: string) => readFileSync(join(cwd, p), "utf8");

/** Turn 1, message 2 and its turn, then the hand edit. */
async function fixture(): Promise<{ id: string; cwd: string }> {
	const { investigationId: id } = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: {
			subject: { kind: "project", repositoryId: projectId },
			text: "fake-session:rewind The checkout client retries too little. Raise the retries step by step.",
			workIn: "worktree",
		},
	});
	const first = await idle(id, "turn 1 to end");
	const cwd = first.workspace?.cwd;
	if (!cwd) throw new Error("the fixture thread has no worktree");
	await pl.api(`/investigations/${id}/messages`, { method: "POST", body: { text: MESSAGE_2 } });
	await eventually(
		() => pl.api<Run>(`/investigations/${id}`),
		(i) => !live(i.status) && read(cwd, "src/app.txt") === APP_TURN_2,
		"turn 2 to end",
		30_000,
	);
	writeFileSync(join(cwd, "README.md"), HAND_EDIT);
	return { id, cwd };
}

/** The kinds of the thread's rewind_interrupted events: each is an operation Restore offers. */
const interruptedOf = async (id: string) =>
	(await visible(id)).flatMap((e) => (e.kind === "rewind_interrupted" ? [e.opKind] : []));

const expectOf = (p: RewindPreview) => ({
	messageOrdinal: p.messageOrdinal,
	revision: p.revision,
	repos: Object.fromEntries(
		p.repos.flatMap((r) => (r.state === "ok" ? [[r.repo, { head: r.head, tree: r.tree }]] : [])),
	),
});

/** Rewinds the message at `seq` against a fresh preview. */
async function rewindAt(id: string, seq: number, text = "Set the retries to 5", rewindId?: string) {
	const p = await rewinds().preview(id, seq, true);
	return rewinds().rewind(
		{ id, seq, text, expect: expectOf(p), include: [], ...(rewindId ? { rewindId } : {}) },
		{ kind: "you" },
		true,
	);
}

/** Stops PrismaLens and starts it again on the same data: its boot hooks run before it serves. */
async function restart() {
	await pl.stop();
	await pl.boot();
}

function doneOf<T extends { state: string }>(r: T): Extract<T, { state: "done" }> {
	if (r.state !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
	return r as Extract<T, { state: "done" }>;
}

beforeAll(async () => {
	await pl.boot();
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	writeFileSync(join(source, "src", "app.txt"), APP_V1);
	const git = (...a: string[]) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: source });
	git("init", "-q", "-b", "main");
	git("config", "core.autocrlf", "false");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	projectId = (
		await pl.api<{ id: string }>("/repositories/source", { method: "POST", body: { source } })
	).id;
}, 90_000);

afterAll(async () => {
	await pl.dispose();
});

describe("RewindService (#1193)", () => {
	it("preview of message 2 folds 1 turn, sets src/app.txt back, keeps the hand edit as yours, and changes nothing", async () => {
		const { id, cwd } = await fixture();
		const before = { events: (await visible(id)).length, sessions: await sessionsOf(id) };

		const p = await rewinds().preview(id, await seqOf(id, MESSAGE_2), true);

		expect(p.block).toBe(null);
		expect(p.turns).toBe(1);
		expect(p.repos.map((r) => (r.state === "ok" ? [r.revert, r.kept, r.duringTurn] : r))).toEqual([
			[[{ path: "src/app.txt", status: "modified" }], [{ path: "README.md", why: "yours" }], []],
		]);
		expect((await visible(id)).length).toBe(before.events);
		expect(await sessionsOf(id)).toEqual(before.sessions);
		expect([read(cwd, "src/app.txt"), read(cwd, "README.md")]).toEqual([APP_TURN_2, HAND_EDIT]);
	});

	it("rewind sets the agent's file back and keeps the hand edit, folds the edited turn from its session divider on, moves the sessions into its marker; undo brings files, transcript and sessions back", async () => {
		const { id, cwd } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const shown = (await visible(id)).map(labelOf);
		const sessions = await sessionsOf(id);
		expect(typeof sessions.acpSessionId).toBe("string");
		const p = await rewinds().preview(id, seq, true);

		const r = await rewinds().rewind(
			{ id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [] },
			{ kind: "you" },
			true,
		);
		if (r.state !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
		expect([r.reverted, r.kept, r.sent]).toEqual([
			[{ repo: p.repos[0]?.repo, path: "src/app.txt" }],
			[{ repo: p.repos[0]?.repo, path: "README.md", why: "yours" }],
			true,
		]);
		const folded = (await rewinds().folded(id, r.rewindId)).map(labelOf);
		expect(folded).toEqual(shown.slice(shown.indexOf(`run ${seq} operator_message`) - 1));
		expect(folded[0]).toBe(`run ${seq - 1} session_opened`);
		expect([read(cwd, "src/app.txt"), read(cwd, "README.md")]).toEqual([APP_TURN_1, HAND_EDIT]);
		const marker = (await visible(id)).find((e) => e.kind === "thread_rewound");
		expect(marker?.kind === "thread_rewound" ? marker.priorSessions : null).toEqual({
			acpSessionId: sessions.acpSessionId,
			agentSessions: sessions.agentSessions,
		});
		await idle(id, "the edited message's turn to end");

		const u = await rewinds().undo(id, r.rewindId, true);

		expect(u).toEqual({ state: "done", restored: [{ repo: p.repos[0]?.repo, path: "src/app.txt" }], kept: [] });
		expect([read(cwd, "src/app.txt"), read(cwd, "README.md")]).toEqual([APP_TURN_2, HAND_EDIT]);
		const after = (await visible(id)).filter((e) => !("branchId" in e) || e.branchId !== "rewinds").map(labelOf);
		expect(after).toEqual(shown);
		expect(await sessionsOf(id)).toEqual(sessions);
		expect(await rewinds().undo(id, r.rewindId, true)).toEqual({ state: "refused", reason: "already-undone", paths: [] });
	});

	it("an open pl_ask_user ask in the folded range closes superseded, and stays closed after Undo", async () => {
		const { id } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		// The service pl_ask_user calls: no agent that forks is served the tool itself.
		const asks = pl.resolve<ToolAsksService>(ToolAsksService) as ToolAsksService;
		const asked = await asks.question(id, [
			{
				id: "q1",
				prompt: "Set the retries to 3 or 5?",
				multiSelect: false,
				allowOther: true,
				required: true,
				options: [
					{ id: "o1", label: "3" },
					{ id: "o2", label: "5" },
				],
			},
		]);
		if ("error" in asked) throw new Error(asked.error);
		const closedOf = async () =>
			(await visible(id)).flatMap((e) =>
				e.kind === "ask_closed" && e.askId === asked.askId ? [e.outcome] : [],
			);
		const rowOf = async () =>
			(await pl.prisma()).toolAsk.findUniqueOrThrow({
				where: { askId: asked.askId },
				select: { status: true, outcome: true },
			});
		const p = await rewinds().preview(id, seq, true);

		const r = await rewinds().rewind(
			{ id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [] },
			{ kind: "you" },
			true,
		);
		if (r.state !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);

		expect(await closedOf()).toEqual(["superseded"]);
		expect(await rowOf()).toEqual({ status: "closed", outcome: "superseded" });
		await idle(id, "the edited message's turn to end");
		expect(await rewinds().undo(id, r.rewindId, true)).toMatchObject({ state: "done" });
		expect(await closedOf()).toEqual(["superseded"]);
		expect(await rowOf()).toEqual({ status: "closed", outcome: "superseded" });
	});

	it("a stale preview is refused stale and writes nothing", async () => {
		const { id, cwd } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const p = await rewinds().preview(id, seq, true);
		writeFileSync(join(cwd, "README.md"), "# shop\n\nEdited again.\n");

		const r = await rewinds().rewind(
			{ id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [] },
			{ kind: "you" },
			true,
		);

		expect(r).toEqual({ state: "refused", reason: "stale", paths: [] });
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
		expect((await visible(id)).some((e) => e.kind === "thread_rewound")).toBe(false);
	});

	it("Edit is refused before-report on a message before the thread's report, and its files stay", async () => {
		const { id, cwd } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const last = Math.max(...(await visible(id)).map((e) => e.seq));
		const report: CanonicalEvent = {
			kind: "report",
			runId: id,
			seq: last + 1,
			ts: new Date(0).toISOString(),
			report: {
				summary: "Retries were too low.",
				rootCause: null,
				rootCauseCategory: null,
				hypotheses: [],
				ruledOut: [],
				coverage: { queried: [], notQueried: [] },
				nextSteps: [],
			},
		};
		await (pl.resolve<InvestigationsService>(InvestigationsService) as InvestigationsService).appendEvents(id, [report]);
		const p = await rewinds().preview(id, seq, true);
		expect(p.block).toBe("before-report");

		const r = await rewinds().rewind(
			{ id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [] },
			{ kind: "you" },
			true,
		);

		expect(r).toEqual({ state: "refused", reason: "before-report", paths: [] });
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("the session continues new for the first message; an OpenCode thread replays with its agent's reason, and any thread with the setting's reason when the setting is replay", async () => {
		const { id } = await fixture();
		const first = (await visible(id)).find((e) => e.kind === "operator_message");
		expect((await rewinds().preview(id, first?.seq as number, true)).session).toEqual({ via: "new", why: null });
		expect((await rewinds().preview(id, await seqOf(id, MESSAGE_2), true)).session).toEqual({
			via: "replay",
			why: "OpenCode can't cut its session at a message",
		});
		await pl.api("/settings/harness", { method: "PATCH", body: { rewindSession: "replay" } });
		try {
			expect((await rewinds().preview(id, await seqOf(id, MESSAGE_2), true)).session).toEqual({
				via: "replay",
				why: "Settings start a new session on an edit",
			});
		} finally {
			await pl.api("/settings/harness", { method: "PATCH", body: { rewindSession: "fork" } });
		}
	});

	it("a Claude Code thread's preview chooses fork at message 2 when the turn before it ended on a plain message", async () => {
		const was = (await pl.api<{ harness: string }>("/settings/harness")).harness;
		await pl.api("/settings/harness", { method: "PATCH", body: { harness: "claude-code" } });
		try {
			const { id } = await fixture();
			const thread = await (await pl.prisma()).investigation.findUniqueOrThrow({ where: { id }, select: { harness: true } });
			expect(thread.harness).toBe("claude-code");
			expect((await rewinds().preview(id, await seqOf(id, MESSAGE_2), true)).session).toEqual({ via: "fork", why: null });
		} finally {
			await pl.api("/settings/harness", { method: "PATCH", body: { harness: was } });
		}
	});

	it("a view-only device sees the view-only block and its rewind is refused view-only", async () => {
		const { id } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const p = await rewinds().preview(id, seq, false);
		expect(p.block).toBe("view-only");

		const r = await rewinds().rewind(
			{ id, seq, text: "x", expect: expectOf(p), include: [] },
			{ kind: "you" },
			false,
		);

		expect(r).toEqual({ state: "refused", reason: "view-only", paths: [] });
	});

	it("boot marks an operation that never committed: interrupted ref plus one rewind_interrupted event, and a second boot adds nothing", async () => {
		const { id } = await fixture();
		const prisma = await pl.prisma();
		const row = await prisma.investigation.findUniqueOrThrow({ where: { id }, select: { workspace: true } });
		const ws = RunWorkspaceSchema.parse(JSON.parse(row.workspace as string)) as RunWorkspace;
		const repo = ws.repos[0]?.name as string;
		const op = randomUUID();
		const rewindId = randomUUID();
		// A refused operation the caller never settled: meta and backup, then nothing.
		await rewindFiles(ws, repo, { runId: id, running: false, canWrite: true }, {
			op,
			rewindId,
			fromSeq: await seqOf(id, MESSAGE_2),
			named: [],
			include: new Set(),
			expect: { head: "stale", tree: "stale" },
		});
		const gitDir = (await snapshotStores()).find((s) => s.runId === id)?.gitDir as string;

		await restart();
		await restart();

		const marked = (await visible(id)).filter((e) => e.kind === "rewind_interrupted");
		const backup = (await storeGit(gitDir, ["rev-parse", `refs/pl/op/${op}/backup`])).trim();
		expect(marked).toEqual([
			expect.objectContaining({
				op,
				repo,
				opKind: "rewind",
				rewindId,
				backup,
				receipt: null,
				written: [],
				branchId: "rewinds",
			}),
		]);
		expect([...((await storeOps(gitDir)).get(op)?.refs ?? [])].toSorted()).toEqual(["backup", "interrupted", "meta"]);
	});

	it("boot writes committed for an operation whose event committed but whose committed ref was lost, and appends no event", async () => {
		const { id } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const p = await rewinds().preview(id, seq, true);
		const r = await rewinds().rewind(
			{ id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [] },
			{ kind: "you" },
			true,
		);
		if (r.state !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
		await idle(id, "the edited message's turn to end");
		const marker = (await visible(id)).find((e) => e.kind === "thread_rewound");
		const op = marker?.kind === "thread_rewound" ? (Object.values(marker.journals)[0] as string) : "";
		const gitDir = (await snapshotStores()).find((s) => s.runId === id)?.gitDir as string;
		await storeGit(gitDir, ["update-ref", "-d", `refs/pl/op/${op}/committed`]);
		const count = (await visible(id)).length;

		await restart();
		await restart();

		expect((await storeOps(gitDir)).get(op)?.refs.has("committed")).toBe(true);
		expect((await storeOps(gitDir)).get(op)?.refs.has("interrupted")).toBe(false);
		expect((await visible(id)).length).toBe(count);
	});

	it("a row appended to a folded branch during the file writes refuses the rewind stale, folds nothing, and puts the files back", async () => {
		const { id, cwd } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const prisma = await pl.prisma();
		let late = "";
		vi.mocked(rewindFiles).mockImplementationOnce(async (...a) => {
			const r = await actual.rewindFiles(...a);
			// An ask answered meanwhile commits on `asks` without the thread's admission.
			const { _max } = await prisma.investigationEvent.aggregate({ where: { investigationId: id }, _max: { seq: true } });
			const at = (_max.seq ?? 0) + 1;
			const row = await prisma.investigationEvent.create({
				data: {
					investigationId: id,
					seq: at,
					branchId: "asks",
					event: JSON.stringify({ kind: "error", runId: id, branchId: "asks", path: [], seq: at, ts: new Date(0).toISOString(), message: "late" }),
				},
			});
			late = row.id;
			return r;
		});

		const r = await rewindAt(id, seq);

		expect(r).toEqual({ state: "refused", reason: "stale", paths: [] });
		expect((await prisma.investigationEvent.findUniqueOrThrow({ where: { id: late } })).foldedBy).toBeNull();
		expect((await visible(id)).some((e) => e.kind === "thread_rewound")).toBe(false);
		expect(await interruptedOf(id)).toEqual([]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("a rewind whose file writer fails partway is refused interrupted, folds nothing, and marks its operation interrupted for Restore", async () => {
		const { id, cwd } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		vi.mocked(rewindFiles).mockImplementationOnce(async (...a) => {
			await actual.rewindFiles(...a);
			throw new Error("disk full");
		});

		const r = await rewindAt(id, seq);

		expect(r).toEqual({ state: "refused", reason: "interrupted", paths: [] });
		expect((await visible(id)).some((e) => e.kind === "thread_rewound")).toBe(false);
		expect(await interruptedOf(id)).toEqual(["rewind"]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_1);
	});

	it("a rewind whose record fails and whose compensation fails is refused interrupted and marks its operation interrupted", async () => {
		const { id, cwd } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const p = await rewinds().preview(id, seq, true);
		const tx = vi.spyOn(await pl.prisma(), "$transaction");
		vi.mocked(rewindFiles).mockImplementationOnce(async (...a) => {
			const r = await actual.rewindFiles(...a);
			tx.mockRejectedValueOnce(new Error("database is locked"));
			return r;
		});
		vi.mocked(undoRewindFiles).mockRejectedValueOnce(new Error("disk full"));

		const r = await rewinds().rewind(
			{ id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [] },
			{ kind: "you" },
			true,
		);

		expect(r).toEqual({ state: "refused", reason: "interrupted", paths: [] });
		expect(await interruptedOf(id)).toEqual(["rewind"]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_1);
	});

	it("an Undo whose file writer fails partway is refused interrupted, keeps the thread rewound, and marks its operation interrupted", async () => {
		const { id } = await fixture();
		const r = doneOf(await rewindAt(id, await seqOf(id, MESSAGE_2)));
		await idle(id, "the edited message's turn to end");
		vi.mocked(undoRewindFiles).mockImplementationOnce(async (...a) => {
			await actual.undoRewindFiles(...a);
			throw new Error("disk full");
		});

		const u = await rewinds().undo(id, r.rewindId, true);

		expect(u).toEqual({ state: "refused", reason: "interrupted", paths: [] });
		expect((await visible(id)).some((e) => e.kind === "rewind_undone")).toBe(false);
		expect(await interruptedOf(id)).toEqual(["undo"]);
	});

	it("an Undo whose record fails after its files went back sets them back through Restore's writer, keeps the thread rewound, and leaves nothing for Restore", async () => {
		const { id, cwd } = await fixture();
		const r = doneOf(await rewindAt(id, await seqOf(id, MESSAGE_2)));
		await idle(id, "the edited message's turn to end");
		const tx = vi.spyOn(await pl.prisma(), "$transaction");
		let undone = "";
		vi.mocked(undoRewindFiles).mockImplementationOnce(async (...a) => {
			const done = await actual.undoRewindFiles(...a);
			undone = read(cwd, "src/app.txt");
			tx.mockRejectedValueOnce(new Error("database is locked"));
			return done;
		});

		await expect(rewinds().undo(id, r.rewindId, true)).rejects.toThrow("database is locked");

		expect(undone).toBe(APP_TURN_2);
		expect((await visible(id)).some((e) => e.kind === "rewind_undone")).toBe(false);
		expect(await interruptedOf(id)).toEqual([]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_1);
		expect(doneOf(await rewinds().undo(id, r.rewindId, true)).restored).toEqual([{ repo: "repo", path: "src/app.txt" }]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("an Undo whose read of the edited message fails after its files went back sets them back and leaves nothing for Restore", async () => {
		const { id, cwd } = await fixture();
		const r = doneOf(await rewindAt(id, await seqOf(id, MESSAGE_2)));
		await idle(id, "the edited message's turn to end");
		const find = vi.spyOn((await pl.prisma()).investigationEvent, "findFirst");
		vi.mocked(undoRewindFiles).mockImplementationOnce(async (...a) => {
			const done = await actual.undoRewindFiles(...a);
			find.mockRejectedValueOnce(new Error("database is locked"));
			return done;
		});

		await expect(rewinds().undo(id, r.rewindId, true)).rejects.toThrow("database is locked");

		expect(await interruptedOf(id)).toEqual([]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_1);
	});

	it("an Undo whose record fails and whose setting back fails is refused interrupted and marks its operation interrupted for Restore", async () => {
		const { id, cwd } = await fixture();
		const r = doneOf(await rewindAt(id, await seqOf(id, MESSAGE_2)));
		await idle(id, "the edited message's turn to end");
		const tx = vi.spyOn(await pl.prisma(), "$transaction");
		vi.mocked(undoRewindFiles).mockImplementationOnce(async (...a) => {
			const done = await actual.undoRewindFiles(...a);
			tx.mockRejectedValueOnce(new Error("database is locked"));
			return done;
		});
		vi.mocked(restoreFiles).mockRejectedValueOnce(new Error("disk full"));

		const u = await rewinds().undo(id, r.rewindId, true);

		expect(u).toEqual({ state: "refused", reason: "interrupted", paths: [] });
		expect(await interruptedOf(id)).toEqual(["undo"]);
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("a rewind asked again with a rewind id whose edit already went returns that rewind as sent, without running or sending it again", async () => {
		const { id } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const rewindId = randomUUID();
		const p = await rewinds().preview(id, seq, true);
		const input = { id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [], rewindId };
		const first = doneOf(await rewinds().rewind(input, { kind: "you" }, true));
		await idle(id, "the edited message's turn to end");

		const again = await rewinds().rewind(input, { kind: "you" }, true);

		expect(again).toEqual({ state: "done", rewindId, reverted: first.reverted, kept: first.kept, sent: true, why: null });
		const after = await visible(id);
		expect(after.filter((e) => e.kind === "thread_rewound").length).toBe(1);
		expect(after.filter((e) => e.kind === "operator_message" && e.text === input.text).length).toBe(1);
	});

	it("a rewind that committed but whose edit was never admitted, asked again after a restart, sends the edit once", async () => {
		const { id } = await fixture();
		const seq = await seqOf(id, MESSAGE_2);
		const rewindId = randomUUID();
		const p = await rewinds().preview(id, seq, true);
		const input = { id, seq, text: "Set the retries to 5", expect: expectOf(p), include: [], rewindId };
		const dispatch = pl.resolve<DispatchService>(DispatchService) as DispatchService;
		// The restart lands between the fold's commit and the edit's admission.
		vi.spyOn(dispatch, "admitHeld").mockRejectedValueOnce(new Error("PrismaLens stopped"));
		const first = doneOf(await rewinds().rewind(input, { kind: "you" }, true));
		expect(first.sent).toBe(false);

		const again = await rewinds().rewind(input, { kind: "you" }, true);
		await idle(id, "the edited message's turn to end");
		const third = await rewinds().rewind(input, { kind: "you" }, true);

		expect(again).toEqual({ state: "done", rewindId, reverted: first.reverted, kept: first.kept, sent: true, why: null });
		expect(third).toEqual(again);
		const after = await visible(id);
		expect(after.filter((e) => e.kind === "thread_rewound").length).toBe(1);
		expect(after.filter((e) => e.kind === "operator_message" && e.text === input.text).length).toBe(1);
	});

	it("a rewind whose send fails after the fold committed is done and unsent, and Undo still works", async () => {
		const { id, cwd } = await fixture();
		const dispatch = pl.resolve<DispatchService>(DispatchService) as DispatchService;
		vi.spyOn(dispatch, "admitHeld").mockRejectedValueOnce(new Error("database is locked"));

		const r = doneOf(await rewindAt(id, await seqOf(id, MESSAGE_2)));

		expect([r.sent, r.why]).toEqual([
			false,
			"PrismaLens could not tell whether the edited message was sent. Check the thread before sending it again.",
		]);
		expect(await rewinds().undo(id, r.rewindId, true)).toMatchObject({ state: "done" });
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("after rewind A, rewind B and Undo of B, Undo of A is done and brings the files back to before A", async () => {
		const { id, cwd } = await fixture();
		const a = doneOf(await rewindAt(id, await seqOf(id, MESSAGE_2), "Set the retries to 5"));
		await idle(id, "A's edited message's turn to end");
		const b = doneOf(await rewindAt(id, await seqOf(id, "Set the retries to 5"), "Set the retries to 7"));
		await idle(id, "B's edited message's turn to end");
		expect(await rewinds().undo(id, b.rewindId, true)).toMatchObject({ state: "done" });

		const u = await rewinds().undo(id, a.rewindId, true);

		expect(u).toMatchObject({ state: "done" });
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("a Restore stopped by a folder that became a link is refused linked with that path, not as a backup that is gone", async () => {
		const { id, cwd } = await fixture();
		vi.mocked(rewindFiles).mockImplementationOnce(async (...a) => {
			await actual.rewindFiles(...a);
			throw new Error("disk full");
		});
		await rewindAt(id, await seqOf(id, MESSAGE_2));
		const ev = (await visible(id)).find((e) => e.kind === "rewind_interrupted");
		if (ev?.kind !== "rewind_interrupted") throw new Error("expected an interrupted rewind");
		const p = await rewinds().restorePreview(id, ev.op, true);
		const outside = join(pl.workspace, `outside-${id}`);
		cpSync(join(cwd, "src"), outside, { recursive: true });
		rmSync(join(cwd, "src"), { recursive: true });
		symlinkSync(outside, join(cwd, "src"), process.platform === "win32" ? "junction" : "dir");

		const r = await rewinds().restore({ id, op: ev.op, expect: { head: p.head, tree: p.tree }, include: [] }, true);

		expect(r).toEqual({ state: "refused", reason: "linked", paths: [{ repo: ev.repo, path: "src/app.txt" }] });
		expect(readFileSync(join(outside, "app.txt"), "utf8")).toBe(APP_TURN_1);
	});

	it("a path saved after the Restore backup is kept, stays offered, and a second Restore writes it", async () => {
		const { id, cwd } = await fixture();
		vi.mocked(rewindFiles).mockImplementationOnce(async (...a) => {
			await actual.rewindFiles(...a);
			throw new Error("disk full");
		});
		await rewindAt(id, await seqOf(id, MESSAGE_2));
		const ev = (await visible(id)).find((e) => e.kind === "rewind_interrupted");
		if (ev?.kind !== "rewind_interrupted") throw new Error("expected an interrupted rewind");
		const first = await rewinds().restorePreview(id, ev.op, true);
		expect(first.overwrite).toEqual(["src/app.txt"]);
		// The save lands at the writer's folder check: after Restore's backup, before its write.
		let saved = false;
		fsHooks.lstat = (p) => {
			if (!saved && p.replaceAll("\\", "/").endsWith("/src")) {
				saved = true;
				writeFileSync(join(cwd, "src", "app.txt"), "saved during the restore\n");
			}
		};
		const r1 = await rewinds().restore({ id, op: ev.op, expect: { head: first.head, tree: first.tree }, include: [] }, true);
		fsHooks.lstat = null;
		expect(r1).toEqual({
			state: "done",
			restored: [],
			kept: [{ repo: ev.repo, path: "src/app.txt", why: "changed-while-rewinding" }],
		});
		expect(read(cwd, "src/app.txt")).toBe("saved during the restore\n");

		const second = await rewinds().restorePreview(id, ev.op, true);
		expect(second.damaged).toEqual(["src/app.txt"]);
		const r2 = await rewinds().restore(
			{ id, op: ev.op, expect: { head: second.head, tree: second.tree }, include: ["src/app.txt"] },
			true,
		);

		expect(r2).toEqual({ state: "done", restored: [{ repo: ev.repo, path: "src/app.txt" }], kept: [] });
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});

	it("Restore stays offered for a path the first Restore left, and writes it when the user ticks it", async () => {
		const { id, cwd } = await fixture();
		vi.mocked(rewindFiles).mockImplementationOnce(async (...a) => {
			await actual.rewindFiles(...a);
			throw new Error("disk full");
		});
		await rewindAt(id, await seqOf(id, MESSAGE_2));
		const ev = (await visible(id)).find((e) => e.kind === "rewind_interrupted");
		if (ev?.kind !== "rewind_interrupted") throw new Error("expected an interrupted rewind");
		writeFileSync(join(cwd, "src", "app.txt"), "edited after the crash\n");
		const first = await rewinds().restorePreview(id, ev.op, true);
		expect(first.damaged).toEqual(["src/app.txt"]);
		expect(
			await rewinds().restore({ id, op: ev.op, expect: { head: first.head, tree: first.tree }, include: [] }, true),
		).toMatchObject({ state: "done", restored: [] });

		const second = await rewinds().restorePreview(id, ev.op, true);
		expect(second.damaged).toEqual(["src/app.txt"]);
		const r = await rewinds().restore(
			{ id, op: ev.op, expect: { head: second.head, tree: second.tree }, include: ["src/app.txt"] },
			true,
		);

		expect(r).toMatchObject({ state: "done", restored: [{ repo: ev.repo, path: "src/app.txt" }] });
		expect(read(cwd, "src/app.txt")).toBe(APP_TURN_2);
	});
});
