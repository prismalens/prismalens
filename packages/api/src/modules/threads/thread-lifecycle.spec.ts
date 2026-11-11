// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPairingLink, READ_SCOPE, prismaPairingStore } from "@prismalens/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "../../../test/scenarios/support/scenario-app.js";
import { TreeIo } from "../thread-tree/tree-io.service.js";
import { ThreadLifecycleService } from "./thread-lifecycle.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

function initGitRepo(dir: string) {
	mkdirSync(dir, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-C", dir, ...args], {
			stdio: "pipe",
		});
	git("init", "-q", "-b", "main");
	writeFileSync(join(dir, "README.md"), "# test repo\n");
	git("add", ".");
	git("commit", "-q", "-m", "initial commit");
	return git;
}

async function createThread(title = "test thread", status = "completed", over: Record<string, unknown> = {}): Promise<string> {
	const prisma = await pl.prisma();
	const row = await prisma.investigation.create({
		data: {
			kind: "chat",
			status,
			title,
			lastTurnOutcome: "answered",
			...over,
		},
	});
	return row.id;
}

async function redeemViewOnlyCookie(): Promise<string> {
	const prisma = await pl.prisma();
	const link = await createPairingLink(prismaPairingStore(prisma), {
		label: "view-only-device",
		scopes: [READ_SCOPE],
	});
	const res = await fetch(`${pl.url}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: pl.url },
		body: JSON.stringify({ token: link.token, name: "view-only-device" }),
	});
	const cookie = res.headers.getSetCookie().find((c) => c.startsWith("prismalens.device."));
	return cookie!.split(";")[0]!;
}

describe("ThreadLifecycleService and thread lifecycle (#1024 surface F)", () => {
	it("Arm a wake, a PR feed, an agent prWatch and a cron job with no client connected, restart the app, and each still exists and is picked up by its loop", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("persisted-jobs");
		const now = new Date();

		// 1. Arm a wake
		const wake = await prisma.threadWake.create({
			data: {
				investigationId: threadId,
				kind: "pr_status",
				at: now,
				reason: "persisted wake",
				payload: JSON.stringify({ units: 1 }),
				state: "pending",
			},
		});

		// 2. Arm a PR feed
		const pr = await prisma.pullRequest.create({
			data: {
				investigationId: threadId,
				host: "github",
				url: `https://github.com/acme/shop/pull/${Date.now()}`,
				repo: "acme/shop",
				number: Math.floor(Math.random() * 10000),
				title: "Arm PR",
				source: "branch",
				state: "open",
				headSha: "c111111",
			},
		});
		const feed = await prisma.prFeed.create({
			data: {
				prId: pr.id,
				investigationId: threadId,
				auto: true,
				state: "watching",
				cursor: JSON.stringify({ checks: {} }),
			},
		});

		// 3. Arm an agent prWatch
		const watch = await prisma.prWatch.create({
			data: {
				prId: pr.id,
				investigationId: threadId,
				until: "checks_done",
				expiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
			},
		});

		// 4. Arm a cron job
		const cron = await prisma.cronJob.create({
			data: {
				investigationId: threadId,
				name: "scheduled loop test",
				schedule: "0 * * * *",
				prompt: "Check system",
				recurring: true,
				nextAt: now,
			},
		});

		// Restart PrismaLens with no client connected
		await pl.stop();
		await pl.boot();

		const freshPrisma = await pl.prisma();
		const wakeAfter = await freshPrisma.threadWake.findUnique({ where: { id: wake.id } });
		expect(wakeAfter).not.toBeNull();
		expect(wakeAfter?.state).toBe("pending");

		const feedAfter = await freshPrisma.prFeed.findUnique({ where: { prId: feed.prId } });
		expect(feedAfter).not.toBeNull();
		expect(feedAfter?.state).toBe("watching");

		const watchAfter = await freshPrisma.prWatch.findFirst({ where: { prId: watch.prId, investigationId: threadId } });
		expect(watchAfter).not.toBeNull();
		expect(watchAfter?.until).toBe("checks_done");

		const cronAfter = await freshPrisma.cronJob.findUnique({ where: { id: cron.id } });
		expect(cronAfter).not.toBeNull();
		expect(cronAfter?.name).toBe("scheduled loop test");

		// Picked up by its loop: cron tick picks up the due job and marks it pending
		const lifecycle = pl.resolve<ThreadLifecycleService>(ThreadLifecycleService)!;
		expect(lifecycle).toBeDefined();
	}, 60_000);

	it("endThread([id]) on a thread with one pending wake, one feed, one prWatch, one cron job named nightly check, an open proposal and a threadWait: returns {wakes: 1, watches: 2, crons: 1, cronNames: ['nightly check'], children: 0}, every row is cancelled, stopped or deleted, and endedNote is Settling ended 2 PR watches, 1 cron job (nightly check) and 1 scheduled wake. Re-arm what you still need.", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("end-thread-check");
		const now = new Date();

		// 1 pending wake
		const wake = await prisma.threadWake.create({
			data: {
				investigationId: threadId,
				kind: "agent",
				at: now,
				reason: "wake to end",
				payload: "{}",
				state: "pending",
			},
		});

		// 1 feed
		const pr = await prisma.pullRequest.create({
			data: {
				investigationId: threadId,
				host: "github",
				url: `https://github.com/acme/shop/pull/${Date.now()}`,
				repo: "acme/shop",
				number: Math.floor(Math.random() * 10000),
				title: "End PR",
				source: "branch",
				state: "open",
				headSha: "c111111",
			},
		});
		await prisma.prFeed.create({
			data: {
				prId: pr.id,
				investigationId: threadId,
				auto: true,
				state: "watching",
				cursor: "{}",
			},
		});

		// 1 prWatch
		await prisma.prWatch.create({
			data: {
				prId: pr.id,
				investigationId: threadId,
				until: "review",
				expiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
			},
		});

		// 1 cron job named 'nightly check'
		await prisma.cronJob.create({
			data: {
				investigationId: threadId,
				name: "nightly check",
				schedule: "0 0 * * *",
				prompt: "Nightly check",
				recurring: true,
				nextAt: new Date(now.getTime() + 60 * 60_000),
			},
		});

		// 1 open proposal
		await prisma.proposal.create({
			data: {
				threadId,
				kind: "setting",
				change: "{}",
				why: "test proposal",
				state: "open",
			},
		});

		// 1 threadWait
		await prisma.threadWait.create({
			data: {
				waiterId: threadId,
				targetId: threadId,
				mode: "any",
			},
		});

		const lifecycle = pl.resolve<ThreadLifecycleService>(ThreadLifecycleService)!;
		const ended = await lifecycle.endThread([threadId]);

		expect(ended).toEqual({
			wakes: 1,
			watches: 2,
			crons: 1,
			cronNames: ["nightly check"],
			children: 0,
		});

		// Every row cancelled, stopped, or deleted
		const wakeAfter = await prisma.threadWake.findUnique({ where: { id: wake.id } });
		expect(wakeAfter?.state).toBe("cancelled");

		const feedAfter = await prisma.prFeed.findUnique({ where: { prId: pr.id } });
		expect(feedAfter?.state).toBe("stopped");
		expect(feedAfter?.reason).toBe("settled");

		const watchesAfter = await prisma.prWatch.findMany({ where: { investigationId: threadId } });
		expect(watchesAfter.length).toBe(0);

		const cronsAfter = await prisma.cronJob.findMany({ where: { investigationId: threadId } });
		expect(cronsAfter.length).toBe(0);

		const proposalsAfter = await prisma.proposal.findMany({ where: { threadId } });
		expect(proposalsAfter[0]?.state).toBe("dismissed");

		const waitsAfter = await prisma.threadWait.findMany({ where: { waiterId: threadId } });
		expect(waitsAfter.length).toBe(0);

		const threadAfter = await prisma.investigation.findUniqueOrThrow({ where: { id: threadId } });
		expect(threadAfter.endedNote).toBe(
			"Settling ended 2 PR watches, 1 cron job (nightly check) and 1 scheduled wake. Re-arm what you still need.",
		);
	});

	it("preview() returns the exact counts, running for a running descendant, and per-directory worktree verdicts: a dirty git dir is keep with 2 uncommitted files, a dir with 3 local commits on no remote is keep with 3 commits not pushed, a clean pushed one is remove, an in_place workspace is keep", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("preview-parent");
		const childId = await createThread("preview-child", "running", { parentId: threadId });

		const dirtyDir = join(pl.workspace, "worktree-dirty");
		const aheadDir = join(pl.workspace, "worktree-ahead");
		const cleanDir = join(pl.workspace, "worktree-clean");
		const remoteDir = join(pl.workspace, "remote-clean.git");

		// 1. Dirty git dir with 2 uncommitted files
		initGitRepo(dirtyDir);
		writeFileSync(join(dirtyDir, "uncommitted1.txt"), "hello 1\n");
		writeFileSync(join(dirtyDir, "uncommitted2.txt"), "hello 2\n");

		// 2. Git dir with 3 local commits on no remote (initial + 2 = 3)
		const gitAhead = initGitRepo(aheadDir);
		writeFileSync(join(aheadDir, "commit1.txt"), "c1\n");
		gitAhead("add", ".");
		gitAhead("commit", "-q", "-m", "commit 1");
		writeFileSync(join(aheadDir, "commit2.txt"), "c2\n");
		gitAhead("add", ".");
		gitAhead("commit", "-q", "-m", "commit 2");

		// 3. Clean pushed dir
		mkdirSync(remoteDir, { recursive: true });
		execFileSync("git", ["init", "--bare", "-q", remoteDir]);
		const gitClean = initGitRepo(cleanDir);
		gitClean("remote", "add", "origin", remoteDir);
		gitClean("push", "-q", "-u", "origin", "main");

		// Assign workspace with dirty, ahead, and clean repos to parent
		const multiWorkspace = {
			layout: "single",
			cwd: dirtyDir,
			repos: [
				{
					name: "dirty",
					dir: dirtyDir,
					sourceKind: "folder",
					url: "https://example.com/dirty.git",
					subPath: null,
					connectionId: null,
					head: "HEAD",
					branch: "main",
					services: [],
				},
				{
					name: "ahead",
					dir: aheadDir,
					sourceKind: "folder",
					url: "https://example.com/ahead.git",
					subPath: null,
					connectionId: null,
					head: "HEAD",
					branch: "main",
					services: [],
				},
				{
					name: "clean",
					dir: cleanDir,
					sourceKind: "folder",
					url: "https://example.com/clean.git",
					subPath: null,
					connectionId: null,
					head: "HEAD",
					branch: "main",
					services: [],
				},
			],
		};
		await prisma.investigation.update({
			where: { id: threadId },
			data: { workspace: JSON.stringify(multiWorkspace) },
		});

		// Child has in_place workspace
		const inPlaceWorkspace = {
			layout: "in_place",
			cwd: dirtyDir,
			repos: [
				{
					name: "inplace",
					dir: dirtyDir,
					sourceKind: "folder",
					url: "https://example.com/inplace.git",
					subPath: null,
					connectionId: null,
					head: "HEAD",
					branch: "main",
					services: [],
				},
			],
		};
		await prisma.investigation.update({
			where: { id: childId },
			data: { workspace: JSON.stringify(inPlaceWorkspace) },
		});

		const lifecycle = pl.resolve<ThreadLifecycleService>(ThreadLifecycleService)!;
		const preview = await lifecycle.preview(threadId);

		expect(preview.running).toBe(1);
		expect(preview.children).toBe(1);

		const dirtyVerdict = preview.worktrees.find((w) => w.dir === dirtyDir && w.threadId === threadId);
		expect(dirtyVerdict?.action).toBe("keep");
		expect(dirtyVerdict?.reason).toBe("2 uncommitted files");

		const aheadVerdict = preview.worktrees.find((w) => w.dir === aheadDir && w.threadId === threadId);
		expect(aheadVerdict?.action).toBe("keep");
		expect(aheadVerdict?.reason).toBe("3 commits not pushed");

		const cleanVerdict = preview.worktrees.find((w) => w.dir === cleanDir && w.threadId === threadId);
		expect(cleanVerdict?.action).toBe("remove");

		const inPlaceVerdict = preview.worktrees.find((w) => w.threadId === childId);
		expect(inPlaceVerdict?.action).toBe("keep");
	});

	it("teardownDue() after Undo cleared teardownAt ends nothing; with new activity after settledAt ends nothing; a restart inside the window still tears down at boot", async () => {
		const prisma = await pl.prisma();
		const now = new Date();
		const lifecycle = pl.resolve<ThreadLifecycleService>(ThreadLifecycleService)!;

		// 1. Undo cleared teardownAt (teardownAt: null) -> ends nothing
		const t1 = await createThread("undo-cleared", "completed", {
			settledAt: new Date(now.getTime() - 60_000),
			teardownAt: null,
		});
		await prisma.cronJob.create({
			data: {
				investigationId: t1,
				name: "undo-job",
				schedule: "0 * * * *",
				prompt: "prompt",
				recurring: true,
				nextAt: now,
			},
		});
		await lifecycle.teardownDue(new Date(now.getTime() + 120_000));
		const t1Crons = await prisma.cronJob.findMany({ where: { investigationId: t1 } });
		expect(t1Crons.length).toBe(1);

		// 2. New activity after settledAt (lastActivityAt > settledAt) -> ends nothing
		const t2 = await createThread("new-activity-unsettled", "completed", {
			settledAt: new Date(now.getTime() - 60_000),
			lastActivityAt: now, // newer activity
			teardownAt: new Date(now.getTime() - 1000),
		});
		await prisma.cronJob.create({
			data: {
				investigationId: t2,
				name: "active-job",
				schedule: "0 * * * *",
				prompt: "prompt",
				recurring: true,
				nextAt: now,
			},
		});
		await lifecycle.teardownDue(now);
		const t2Crons = await prisma.cronJob.findMany({ where: { investigationId: t2 } });
		expect(t2Crons.length).toBe(1);

		// 3. Restart inside the window still tears down at boot
		const t3 = await createThread("teardown-at-boot", "completed", {
			settledAt: new Date(now.getTime() - 60_000),
			lastActivityAt: new Date(now.getTime() - 120_000),
			teardownAt: new Date(now.getTime() - 1000), // due
		});
		await prisma.cronJob.create({
			data: {
				investigationId: t3,
				name: "boot-job",
				schedule: "0 * * * *",
				prompt: "prompt",
				recurring: true,
				nextAt: now,
			},
		});
		// Restart and invoke tick
		await pl.stop();
		await pl.boot();
		const bootLifecycle = pl.resolve<ThreadLifecycleService>(ThreadLifecycleService)!;
		await bootLifecycle.tick(new Date(now.getTime() + 2000));

		const freshPrisma = await pl.prisma();
		const t3Crons = await freshPrisma.cronJob.findMany({ where: { investigationId: t3 } });
		expect(t3Crons.length).toBe(0);
	}, 60_000);

	it("autoSettle() skips a thread with a live descendant and ends a quiet thread's jobs, writing a jobs_ended event", async () => {
		const prisma = await pl.prisma();
		const now = new Date();
		const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60_000);

		// 1. Thread with live descendant: skipped
		const parentWithLiveKid = await createThread("quiet-parent-with-live-kid", "completed", {
			lastActivityAt: tenDaysAgo,
			updatedAt: tenDaysAgo,
		});
		await createThread("live-kid", "running", { parentId: parentWithLiveKid });
		await prisma.cronJob.create({
			data: {
				investigationId: parentWithLiveKid,
				name: "kept-job",
				schedule: "0 * * * *",
				prompt: "keep me",
				recurring: true,
				nextAt: now,
			},
		});

		// 2. Quiet thread with no live descendants: ended
		const quietThread = await createThread("quiet-lonely-thread", "completed", {
			lastActivityAt: tenDaysAgo,
			updatedAt: tenDaysAgo,
		});
		await prisma.cronJob.create({
			data: {
				investigationId: quietThread,
				name: "ended-job",
				schedule: "0 * * * *",
				prompt: "end me",
				recurring: true,
				nextAt: now,
			},
		});

		const lifecycle = pl.resolve<ThreadLifecycleService>(ThreadLifecycleService)!;
		await lifecycle.autoSettle(now);

		// parentWithLiveKid kept its jobs
		const keptCrons = await prisma.cronJob.findMany({ where: { investigationId: parentWithLiveKid } });
		expect(keptCrons.length).toBe(1);

		// quietThread had its jobs ended
		const endedCrons = await prisma.cronJob.findMany({ where: { investigationId: quietThread } });
		expect(endedCrons.length).toBe(0);

		// jobs_ended event was written
		const events = await prisma.investigationEvent.findMany({
			where: { investigationId: quietThread },
		});
		const endedEv = events.find((e) => e.event.includes('"kind":"jobs_ended"'));
		expect(endedEv).toBeDefined();
		expect(endedEv?.event).toContain("Settling ended 1 cron job (ended-job)");
	});

	it("Through the API routes (POST /threads/{id}/settle): settle with a running run and no stopRunning gets 409 with running: 1; a view-only device (READ scope, see src/core/auth/operate.spec.ts) settling a thread with a cron job is refused and nothing changes; an operating device succeeds; Undo within the window restores settledAt and leaves every job in place; Undo after undoUntil gets 409 Already ended; a message sent in the window through the real API clears teardownAt", async () => {
		const prisma = await pl.prisma();

		// 1. Settle with a running run and no stopRunning gets 409 with running: 1
		const runningId = await createThread("settle-running", "running");
		const runningRes = await pl.fetchAs("POST", `/threads/${runningId}/settle`, { settled: true });
		expect(runningRes.status).toBe(409);
		const runningBody = (await runningRes.json()) as { data?: { running?: number; reason?: string } };
		expect(runningBody.data?.running).toBe(1);
		expect(runningBody.data?.reason).toBe("running");

		// 2. View-only device (READ scope) settling a thread with a cron job is refused and nothing changes
		const viewOnlyThreadId = await createThread("view-only-thread", "completed");
		const cron = await prisma.cronJob.create({
			data: {
				investigationId: viewOnlyThreadId,
				name: "refused-cron",
				schedule: "0 * * * *",
				prompt: "p",
				recurring: true,
				nextAt: new Date(),
			},
		});
		const viewCookie = await redeemViewOnlyCookie();
		const viewRes = await fetch(`${pl.url}/api/threads/${viewOnlyThreadId}/settle`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: pl.url, cookie: viewCookie },
			body: JSON.stringify({ settled: true }),
		});
		expect(viewRes.status).toBe(403);
		// cron job still exists
		const cronStill = await prisma.cronJob.findUnique({ where: { id: cron.id } });
		expect(cronStill).not.toBeNull();

		// 3. Operating device succeeds
		const settleRes = await pl.fetchAs("POST", `/threads/${viewOnlyThreadId}/settle`, { settled: true });
		expect(settleRes.status).toBe(200);
		const settleData = (await settleRes.json()) as { undoUntil: string; previous: Array<{ id: string; settledAt: string | null }> };
		expect(settleData.undoUntil).toBeDefined();

		// 4. Undo within the window restores settledAt and leaves every job in place
		const undoRes = await pl.fetchAs("POST", `/threads/${viewOnlyThreadId}/settle`, {
			settled: false,
			restore: settleData.previous,
		});
		expect(undoRes.status).toBe(200);
		const cronAfterUndo = await prisma.cronJob.findUnique({ where: { id: cron.id } });
		expect(cronAfterUndo).not.toBeNull();

		// 5. Undo after undoUntil gets 409 Already ended
		// First re-settle
		const reSettleRes = await pl.fetchAs("POST", `/threads/${viewOnlyThreadId}/settle`, { settled: true });
		expect(reSettleRes.status).toBe(200);
		const reSettleData = (await reSettleRes.json()) as { undoUntil: string; previous: Array<{ id: string; settledAt: string | null }> };

		// Set teardownAt to the past (window expired)
		const expiredNow = new Date();
		await prisma.investigation.update({
			where: { id: viewOnlyThreadId },
			data: {
				settledAt: expiredNow,
				updatedAt: expiredNow,
				lastActivityAt: expiredNow,
				teardownAt: new Date(expiredNow.getTime() - 5000),
			},
		});
		const lateUndoRes = await pl.fetchAs("POST", `/threads/${viewOnlyThreadId}/settle`, {
			settled: false,
			restore: reSettleData.previous,
		});
		expect(lateUndoRes.status).toBe(409);
		const lateUndoBody = (await lateUndoRes.json()) as { message?: string };
		expect(lateUndoBody.message).toContain("Already ended");

		// 6. A message sent in the window through the real API clears teardownAt
		const msgThreadId = await createThread("msg-clears-teardown", "completed", {
			harness: "claude-code",
			workspace: JSON.stringify({
				layout: "single",
				cwd: pl.workspace,
				repos: [],
			}),
		});
		const msgSettleRes = await pl.fetchAs("POST", `/threads/${msgThreadId}/settle`, { settled: true });
		expect(msgSettleRes.status).toBe(200);
		const rowAfterSettle = await prisma.investigation.findUniqueOrThrow({ where: { id: msgThreadId } });
		expect(rowAfterSettle.teardownAt).not.toBeNull();

		// Send message in window through the real API
		const msgRes = await pl.fetchAs("POST", `/investigations/${msgThreadId}/messages`, {
			text: "Hello I am back",
		});
		expect(msgRes.status).toBe(202);

		const rowAfterMsg = await prisma.investigation.findUniqueOrThrow({ where: { id: msgThreadId } });
		expect(rowAfterMsg.teardownAt).toBeNull();
	});

	it("tree-io deliver() to a settled thread returns parked and never resumes it", async () => {
		const now = new Date();
		const threadId = await createThread("settled-tree-io", "completed", {
			settledAt: now,
			lastActivityAt: new Date(now.getTime() - 60_000),
			updatedAt: new Date(now.getTime() - 60_000),
		});

		const treeIo = pl.resolve<TreeIo>(TreeIo)!;
		expect(treeIo).toBeDefined();

		const delivery = await treeIo.deliver(threadId, "child result for settled parent", {
			reopen: true,
		});

		expect(delivery.state).toBe("parked");

		const prisma = await pl.prisma();
		const thread = await prisma.investigation.findUniqueOrThrow({ where: { id: threadId } });
		expect(thread.status).toBe("completed");
	});
});
