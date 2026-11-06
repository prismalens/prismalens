// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Wakes and the session lifecycle over a temp SQLite database (#1024).
 */
import { rmSync } from "node:fs";
import type { CanonicalEvent } from "@prismalens/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-wakes-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { CheckoutGone, FollowUpRefused } = await import("../../infrastructure/dispatch/dispatch.service.js");
const { WakesService } = await import("./wakes.service.js");
const { SessionLifecycleService } = await import("./session-lifecycle.service.js");
const { LIMIT_RESET_NOTE } = await import("./session.js");

type Prisma = InstanceType<typeof PrismaService>;

const RESET_TEXT = "You've hit your usage limit. Try again at Jan 1st, 2099 3:45 PM.";
const RESET = new Date(2099, 0, 1, 15, 45, 0);

describe("WakesService and SessionLifecycleService (#1024)", () => {
	let prisma: Prisma;
	let wakes: InstanceType<typeof WakesService>;
	let settings: Record<string, unknown>;
	const resumed: Array<{ id: string; text: string; kind: string; session: unknown }> = [];
	const sent: Array<{ id: string; text: string; messageId?: string }> = [];
	let refuse: Error | null = null;
	let sendState: "queued" | "sent" | null = "queued";
	let listener: ((id: string, o: { outcome: string; error?: string }) => Promise<void> | void) | null = null;

	const dispatch = {
		onRunSettled: (fn: typeof listener) => {
			listener = fn;
		},
		resumeInvestigation: vi.fn(
			async (id: string, text: string, _mode: string, kind: string, _a: unknown, _to: unknown, session: unknown) => {
				if (refuse) throw refuse;
				const { wakeId, wakeDoneAt } = (session ?? {}) as { wakeId?: string; wakeDoneAt?: Date };
				if (wakeId) {
					const { count } = await prisma.threadWake.updateMany({
						where: { id: wakeId, state: "pending" },
						data: { state: "done", doneAt: wakeDoneAt ?? new Date() },
					});
					if (!count) return false;
				}
				resumed.push({ id, text, kind, session });
				return true;
			},
		),
		sendMessage: vi.fn((id: string, text: string, _mode?: string, _a?: unknown, _k?: unknown, messageId?: string) => {
			sent.push({ id, text, ...(messageId ? { messageId } : {}) });
			return sendState;
		}),
	};
	const investigations = {
		allEvents: async (id: string) =>
			(await prisma.investigationEvent.findMany({ where: { investigationId: id }, orderBy: { seq: "asc" } })).map(
				(r) => JSON.parse(r.event) as CanonicalEvent,
			),
		lastEventSeq: async (id: string) =>
			(await prisma.investigationEvent.aggregate({ where: { investigationId: id }, _max: { seq: true } }))._max.seq ??
			-1,
		appendEvents: async (id: string, events: CanonicalEvent[]) => {
			for (const e of events)
				await prisma.investigationEvent.create({
					data: { investigationId: id, seq: e.seq, branchId: "run", event: JSON.stringify(e) },
				});
			return { inserted: events.length, duplicates: 0 };
		},
	};
	const harness = { getSettings: async () => settings };

	function lifecycle(now = new Date(2026, 10, 7, 13, 12)) {
		const s = new SessionLifecycleService(prisma, wakes, dispatch as never, harness as never, investigations as never);
		s.now = () => now;
		s.onModuleInit();
		return s;
	}

	async function thread(over: Record<string, unknown> = {}) {
		return prisma.investigation.create({
			data: {
				status: "failed",
				kind: "investigation",
				harness: "codex",
				workspace: "{}",
				error: RESET_TEXT,
				usage: JSON.stringify({ used: 12_000, size: 200_000 }),
				...over,
			},
		});
	}

	async function say(id: string, events: Array<Record<string, unknown>>) {
		const seq = (await investigations.lastEventSeq(id)) + 1;
		await investigations.appendEvents(
			id,
			events.map((e, i) => ({ runId: id, branchId: "run", path: [], seq: seq + i, ts: new Date().toISOString(), ...e })) as unknown as CanonicalEvent[],
		);
	}

	async function kinds(id: string) {
		return (await investigations.allEvents(id)).map((e) => e.kind);
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		wakes = new WakesService(prisma);
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	beforeEach(async () => {
		await prisma.threadWake.deleteMany();
		await prisma.investigationEvent.deleteMany();
		await prisma.investigation.deleteMany();
		settings = { harness: "auto" };
		resumed.length = 0;
		sent.length = 0;
		refuse = null;
		sendState = "queued";
		dispatch.resumeInvestigation.mockClear();
	});

	describe("WakesService", () => {
		it("answers only due pending wakes, oldest first", async () => {
			const a = await thread();
			const b = await thread();
			const now = new Date("2026-11-07T12:00:00Z");
			await wakes.schedule(a.id, "agent", new Date("2026-11-07T11:00:00Z"), "later");
			await wakes.schedule(b.id, "agent", new Date("2026-11-07T10:00:00Z"), "earlier");
			await wakes.schedule(b.id, "limit", new Date("2026-11-07T13:00:00Z"), "not yet");
			expect((await wakes.due(now)).map((w) => w.reason)).toEqual(["earlier", "later"]);
		});

		it("replaces the pending wake of the same kind, and never another kind's", async () => {
			const t = await thread();
			await wakes.schedule(t.id, "limit", new Date(1), "first limit");
			await wakes.schedule(t.id, "agent", new Date(1), "agent's");
			await wakes.schedule(t.id, "limit", new Date(2), "second limit");
			const rows = await prisma.threadWake.findMany({ where: { investigationId: t.id }, orderBy: { createdAt: "asc" } });
			expect(rows.map((r) => [r.reason, r.state])).toEqual([
				["first limit", "cancelled"],
				["agent's", "pending"],
				["second limit", "pending"],
			]);
		});

		it("cancels one wake, or a thread's pending wakes of one kind", async () => {
			const t = await thread();
			const id = await wakes.schedule(t.id, "agent", new Date(1), "x");
			expect(await wakes.cancel(id)).toBe(true);
			expect(await wakes.cancel(id)).toBe(false);
			await wakes.schedule(t.id, "pr_watch", new Date(1), "y");
			expect(await wakes.cancelKind(t.id, "pr_watch")).toBe(1);
			expect(await wakes.due(new Date())).toEqual([]);
		});

		it("a wake missed while PrismaLens was off is due once on the next pass, then never again", async () => {
			const t = await thread();
			await wakes.schedule(t.id, "agent", new Date("2026-11-01T00:00:00Z"), "missed");
			// A new service over the same table: what a restart sees.
			const after = new WakesService(prisma);
			const [due] = await after.due(new Date("2026-11-07T00:00:00Z"));
			expect(due?.reason).toBe("missed");
			expect(await after.finish(due?.id as string, "done")).toBe(true);
			expect(await after.finish(due?.id as string, "done")).toBe(false);
			expect(await after.due(new Date("2026-11-08T00:00:00Z"))).toEqual([]);
		});

		it("reads a payload it cannot parse as empty", async () => {
			const t = await thread();
			await prisma.threadWake.create({ data: { investigationId: t.id, kind: "agent", at: new Date(1), reason: "x", payload: "{" } });
			expect((await wakes.due(new Date()))[0]?.payload).toEqual({});
		});
	});

	describe("a usage limit: classify, extract, schedule, resume", () => {
		it("schedules the resume at Codex's reset plus two minutes, and says so in the conversation", async () => {
			const t = await thread();
			const s = lifecycle();
			await listener?.(t.id, { outcome: "failed", error: RESET_TEXT });
			const wake = await wakes.latest(t.id, "limit");
			expect(wake).toMatchObject({ state: "pending", attempts: 1 });
			expect(wake?.at).toEqual(new Date(RESET.getTime() + 2 * 60_000));
			const row = await prisma.investigation.findUniqueOrThrow({ where: { id: t.id } });
			expect(row).toMatchObject({ endReason: "limited", limitResetsAt: RESET });
			const events = await investigations.allEvents(t.id);
			expect(events[0]).toMatchObject({ kind: "usage_limit", agent: "Codex", text: RESET_TEXT, resetsAt: RESET.toISOString() });
			expect(events[1]).toMatchObject({ kind: "resume_scheduled", wakeKind: "limit", attempt: 1 });
			expect((await s.sessionOf(row)).limit).toMatchObject({ resetsAt: RESET.toISOString(), autoResume: true, attempts: 1 });
		});

		it("a later transient error never schedules from an older limit's stored text, and clears the stale limit", async () => {
			const t = await thread({ endReason: "limited" });
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: "Quota exceeded for quota metric. Please retry in 20s." });
			expect(await wakes.latest(t.id, "limit")).toBeNull();
			expect((await prisma.investigation.findUniqueOrThrow({ where: { id: t.id } })).endReason).toBeNull();
		});

		it("a short retry the agent makes itself schedules nothing", async () => {
			const t = await thread({ error: "Quota exceeded for quota metric. Please retry in 20s." });
			lifecycle();
			await listener?.(t.id, { outcome: "failed", error: "Quota exceeded for quota metric. Please retry in 20s." });
			expect(await wakes.latest(t.id, "limit")).toBeNull();
			expect(await kinds(t.id)).toEqual([]);
		});

		it("with no time, retries every 30 minutes up to 6 times, then stops and says so", async () => {
			const text = "You've hit your session limit · resets 6:10am (Europe/London)";
			const t = await thread({ harness: "claude-code", error: text });
			let now = new Date(2026, 10, 7, 13, 0);
			for (let attempt = 1; attempt <= 6; attempt++) {
				const s = lifecycle(now);
				await s.onSettled(t.id, { outcome: "failed", error: text });
				const wake = await wakes.latest(t.id, "limit");
				expect(wake).toMatchObject({ state: "pending", attempts: attempt });
				expect(wake?.at).toEqual(new Date(now.getTime() + 30 * 60_000));
				now = new Date(now.getTime() + 31 * 60_000);
				await lifecycle(now).process(now);
				expect((await wakes.latest(t.id, "limit"))?.state).toBe("done");
			}
			const s = lifecycle(now);
			await s.onSettled(t.id, { outcome: "failed", error: text });
			const last = await wakes.latest(t.id, "limit");
			expect(last).toMatchObject({ state: "skipped", attempts: 7, payload: { gaveUp: true } });
			expect((await investigations.allEvents(t.id)).at(-1)).toMatchObject({ kind: "resume_scheduled", at: null, gaveUp: true });
			const row = await prisma.investigation.findUniqueOrThrow({ where: { id: t.id } });
			expect((await s.sessionOf(row)).limit).toMatchObject({ gaveUp: true });
			expect((await s.sessionOf(row)).limit?.nextAttemptAt).toBeUndefined();
		});

		it("resumes by re-sending the interrupted turn with the reset note, and never an unsent draft", async () => {
			const t = await thread();
			await say(t.id, [
				{ kind: "operator_message", text: "Why is checkout slow?", mode: "queue", delivered: true },
				{ kind: "agent_step", text: "Looking.", toolCalls: [] },
			]);
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed).toEqual([
				{
					id: t.id,
					text: `${LIMIT_RESET_NOTE}\n\nWhy is checkout slow?`,
					kind: "continue",
					session: { wakeId: expect.any(String), wakeDoneAt: expect.any(Date) },
				},
			]);
			expect((await wakes.latest(t.id, "limit"))?.state).toBe("done");
			expect((await investigations.allEvents(t.id)).at(-1)).toMatchObject({ kind: "resumed", reason: "limit_reset" });
		});

		it("a queued message the limit kept from the agent is what resumes", async () => {
			const t = await thread({ kind: "chat" });
			await say(t.id, [
				{ kind: "operator_message", text: "First.", mode: "queue", delivered: true },
				{ kind: "message_queued", messageId: "6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a", text: "Then this." },
			]);
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed[0]).toMatchObject({ text: `${LIMIT_RESET_NOTE}\n\nThen this.`, kind: "chat" });
		});

		it("sends the draft at the reset only after the user's own click, which can be cleared before the wake", async () => {
			const t = await thread();
			await say(t.id, [{ kind: "operator_message", text: "Why?", mode: "queue", delivered: true }]);
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await s.setAutoResume(t.id, true, "And check the cache.");
			const row = await prisma.investigation.findUniqueOrThrow({ where: { id: t.id } });
			expect((await s.sessionOf(row)).limit?.message).toBe("And check the cache.");
			await s.setAutoResume(t.id, true, null);
			expect((await s.sessionOf(row)).limit?.message).toBeUndefined();
			await s.setAutoResume(t.id, true, "Only this.");
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed[0]?.text).toBe(`${LIMIT_RESET_NOTE}\n\nWhy?\n\nOnly this.`);
		});

		it("with auto-resume off the wake waits, and turning it back on resumes at the next pass", async () => {
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await s.setAutoResume(t.id, false);
			const later = new Date(RESET.getTime() + 3 * 60_000);
			await s.process(later);
			expect(resumed).toEqual([]);
			expect((await wakes.latest(t.id, "limit"))?.state).toBe("pending");
			await s.setAutoResume(t.id, true);
			await s.process(later);
			expect(resumed).toHaveLength(1);
		});

		it("the setting turns the resume off for threads that chose nothing, and the event says nothing is scheduled", async () => {
			settings = { harness: "auto", resumeAfterLimit: false };
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			expect(await kinds(t.id)).toEqual(["usage_limit"]);
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed).toEqual([]);
		});

		it("compacts first with the agent's own command when the context is large, and never starts fresh", async () => {
			const t = await thread({ usage: JSON.stringify({ used: 142_000, size: 200_000 }) });
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed[0]?.session).toEqual({
				compact: { command: "compact" },
				wakeId: expect.any(String),
				wakeDoneAt: expect.any(Date),
			});
		});

		it("is skipped when the thread is already running again", async () => {
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await prisma.investigation.update({ where: { id: t.id }, data: { status: "running" } });
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed).toEqual([]);
			expect(await wakes.latest(t.id, "limit")).toMatchObject({ state: "skipped", payload: { skipped: "running" } });
		});

		it("a turn that ends any other way retires the pending resume", async () => {
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await prisma.investigation.update({ where: { id: t.id }, data: { error: null } });
			await s.onSettled(t.id, { outcome: "succeeded" });
			expect((await wakes.latest(t.id, "limit"))?.state).toBe("cancelled");
			expect((await prisma.investigation.findUniqueOrThrow({ where: { id: t.id } })).limitResetsAt).toBeNull();
		});

		it("a checkout that is gone drops the wake at once instead of retrying", async () => {
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			refuse = new CheckoutGone("The checkout moved.");
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(await wakes.latest(t.id, "limit")).toMatchObject({
				state: "skipped",
				payload: { skipped: "The checkout moved." },
			});
		});

		it("a refused resume waits for the next pass, records its resume once, and gives up after a day", async () => {
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			refuse = new FollowUpRefused("The checkout is in use.");
			const at = new Date(RESET.getTime() + 2 * 60_000);
			await s.process(new Date(at.getTime() + 60_000));
			await s.process(new Date(at.getTime() + 120_000));
			expect((await wakes.latest(t.id, "limit"))?.state).toBe("pending");
			expect((await kinds(t.id)).filter((k) => k === "resumed")).toHaveLength(1);
			await s.process(new Date(at.getTime() + 24 * 60 * 60_000));
			expect(await wakes.latest(t.id, "limit")).toMatchObject({ state: "skipped", payload: { skipped: "The checkout is in use." } });
		});

	});

	describe("pre-merge re-review (#1024)", () => {
		it("a reason the run queued but never delivered is not lost when the run fails", async () => {
			const t = await thread({ status: "running" });
			const s = lifecycle();
			const id = await wakes.schedule(t.id, "agent", new Date(1), "Check the deploy again.");
			await s.process(new Date());
			await say(t.id, [{ kind: "message_queued", messageId: id, text: "Check the deploy again." }]);
			await s.process(new Date());
			expect((await wakes.latest(t.id, "agent"))?.state).toBe("pending");
			await prisma.investigation.update({ where: { id: t.id }, data: { status: "failed" } });
			await s.process(new Date());
			expect(resumed).toEqual([
				{ id: t.id, text: "Check the deploy again.", kind: "chat", session: expect.objectContaining({ wakeId: id }) },
			]);
		});

		it("a no-time wake that fired late still counts its attempts", async () => {
			const text = "You've hit your session limit · resets 6:10am (Europe/London)";
			const t = await thread({ harness: "claude-code", error: text });
			const start = new Date(2026, 10, 7, 13, 0);
			await lifecycle(start).onSettled(t.id, { outcome: "failed", error: text });
			// The machine slept: the 13:30 wake fires at 16:30, and the resumed turn hits the limit again.
			const late = new Date(start.getTime() + 210 * 60_000);
			await lifecycle(late).process(late);
			await lifecycle(new Date(late.getTime() + 60_000)).onSettled(t.id, { outcome: "failed", error: text });
			expect((await wakes.latest(t.id, "limit"))?.attempts).toBe(2);
		});

		it("idle compactions that fire late still keep to three an hour", async () => {
			settings = { harness: "auto", compactIdle: true };
			const last = new Date(2026, 10, 7, 9, 0);
			const s = lifecycle();
			s.facts = () => ({ label: "Agent", cacheTtlMinutes: 60, compactsWhenIdle: false, compactCommand: "compact" });
			for (let i = 0; i < 4; i++) {
				const t = await thread({ status: "completed", lastActivityAt: last, usage: JSON.stringify({ used: 80_000, size: 200_000 }) });
				await s.onSettled(t.id, { outcome: "succeeded" });
			}
			// Due at 9:55, run at 13:12 after PrismaLens was off: the cap counts when they ran.
			await s.process(new Date(2026, 10, 7, 13, 12));
			expect(resumed).toHaveLength(3);
		});
	});

	describe("pre-merge review (#1024)", () => {
		it("hands its wake to the admission to consume, and ends it nowhere else", async () => {
			const t = await thread();
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			const wake = await wakes.latest(t.id, "limit");
			// Ending the wake after admission fails, as a crash there would.
			const finish = vi.spyOn(wakes, "finish").mockRejectedValue(new Error("crashed"));
			await s.process(new Date(RESET.getTime() + 3 * 60_000)).catch(() => {});
			finish.mockRestore();
			await s.process(new Date(RESET.getTime() + 4 * 60_000));
			expect(resumed).toHaveLength(1);
			expect(resumed[0]?.session).toMatchObject({ wakeId: wake?.id });
		});

		it("keeps every submitted message whole, however long", async () => {
			const t = await thread({ kind: "chat" });
			const a = `first ${"a".repeat(3990)}`;
			const b = `second ${"b".repeat(3990)}`;
			await say(t.id, [
				{ kind: "message_queued", messageId: "6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a", text: a },
				{ kind: "message_queued", messageId: "7b2c8a1f-3b53-4d9f-8e47-1a8d2c3f4e5b", text: b },
			]);
			const s = lifecycle();
			await s.onSettled(t.id, { outcome: "failed", error: RESET_TEXT });
			await s.setAutoResume(t.id, true, "c".repeat(4000));
			await s.process(new Date(RESET.getTime() + 3 * 60_000));
			expect(resumed[0]?.text).toBe(`${LIMIT_RESET_NOTE}

${a}

${b}

${"c".repeat(4000)}`);
			expect(resumed[0]?.session).toMatchObject({
				delivers: ["6a1b7f0e-2a42-4c8e-9d36-0f7c1b2e3d4a", "7b2c8a1f-3b53-4d9f-8e47-1a8d2c3f4e5b"],
			});
		});

		it("wakes held back by an auto-resume turned off never starve a later wake", async () => {
			for (let i = 0; i < 60; i++) {
				const held = await thread({ autoResume: false });
				await wakes.schedule(held.id, "limit", new Date(1_000 + i), "usage limit");
			}
			const t = await thread({ status: "completed" });
			await wakes.schedule(t.id, "agent", new Date(10_000), "Look again.");
			await lifecycle().process(new Date(20_000));
			expect(resumed.map((r) => r.text)).toEqual(["Look again."]);
		});
	});

	describe("agent and PR wakes", () => {
		it("queues its reason under the wake's id while the thread runs, and is done only once the agent received it", async () => {
			const t = await thread({ status: "running" });
			const s = lifecycle();
			const id = await wakes.schedule(t.id, "agent", new Date(1), "Check the deploy again.");
			sendState = null;
			await s.process(new Date());
			expect((await wakes.latest(t.id, "agent"))?.state).toBe("pending");
			sendState = "queued";
			await s.process(new Date());
			expect(sent.at(-1)).toEqual({ id: t.id, text: "Check the deploy again.", messageId: id });
			// Queued in memory only: a crash now would lose it, so the wake stays.
			expect((await wakes.latest(t.id, "agent"))?.state).toBe("pending");
			const sends = sent.length;
			await s.process(new Date());
			expect(sent).toHaveLength(sends);
			await say(t.id, [{ kind: "message_queued", messageId: id, text: "Check the deploy again." }]);
			await s.process(new Date());
			expect((await wakes.latest(t.id, "agent"))?.state).toBe("pending");
			expect(sent).toHaveLength(sends);
			await say(t.id, [
				{ kind: "operator_message", text: "Check the deploy again.", mode: "queue", delivered: true, messageId: id },
			]);
			await s.process(new Date());
			expect((await wakes.latest(t.id, "agent"))?.state).toBe("done");
		});

		it("a queued reason the run never delivered is taken up once the thread finishes", async () => {
			const t = await thread({ status: "running" });
			const s = lifecycle();
			const id = await wakes.schedule(t.id, "agent", new Date(1), "Check the deploy again.");
			await s.process(new Date());
			await prisma.investigation.update({ where: { id: t.id }, data: { status: "completed" } });
			await say(t.id, [{ kind: "operator_message", text: "Check the deploy again.", mode: "queue", delivered: false, messageId: id }]);
			await s.process(new Date());
			expect(resumed[0]).toMatchObject({ text: "Check the deploy again.", kind: "chat" });
			expect((await wakes.latest(t.id, "agent"))?.state).toBe("done");
		});

		it("takes a finished thread up with its reason", async () => {
			const t = await thread({ status: "completed" });
			const s = lifecycle();
			await wakes.schedule(t.id, "pr_watch", new Date(1), "The PR's checks finished.");
			await s.process(new Date());
			expect(resumed[0]).toMatchObject({ text: "The PR's checks finished.", kind: "chat" });
			expect((await investigations.allEvents(t.id)).at(-1)).toMatchObject({ kind: "resumed", reason: "wake" });
		});
	});

	describe("compaction", () => {
		const qualifying = () => ({ label: "Agent", cacheTtlMinutes: 60, compactsWhenIdle: false, compactCommand: "compact" });

		it("compacts a finished thread with the agent's command, and refuses one that has none or is running", async () => {
			const t = await thread({ status: "completed" });
			const s = lifecycle();
			await s.compact(t.id, "keep the findings");
			expect(resumed[0]).toMatchObject({
				text: "/compact",
				session: { compact: { command: "compact", instructions: "keep the findings", only: true } },
			});
			const g = await thread({ status: "completed", harness: "gemini" });
			await expect(s.compact(g.id)).rejects.toThrow("has no compact command");
			const r = await thread({ status: "running" });
			await expect(s.compact(r.id)).rejects.toThrow("running");
		});

		it("idle compaction is off by default", async () => {
			const t = await thread({ status: "completed", usage: JSON.stringify({ used: 80_000, size: 200_000 }) });
			const s = lifecycle();
			s.facts = qualifying;
			await s.onSettled(t.id, { outcome: "succeeded" });
			expect(await wakes.latest(t.id, "idle_compact")).toBeNull();
		});

		it("when on, wakes five minutes before the agent's cache expires and compacts with its command alone", async () => {
			settings = { harness: "auto", compactIdle: true };
			const last = new Date(2026, 10, 7, 12, 0);
			const t = await thread({ status: "completed", lastActivityAt: last, usage: JSON.stringify({ used: 80_000, size: 200_000 }) });
			const s = lifecycle();
			s.facts = qualifying;
			await s.onSettled(t.id, { outcome: "succeeded" });
			const wake = await wakes.latest(t.id, "idle_compact");
			expect(wake?.at).toEqual(new Date(last.getTime() + 55 * 60_000));
			await s.process(new Date(last.getTime() + 56 * 60_000));
			expect(resumed[0]).toMatchObject({ text: "/compact", session: { compact: { command: "compact", only: true } } });
		});

		it("skips agents that compact themselves, small contexts and agents with no known cache lifetime", async () => {
			settings = { harness: "auto", compactIdle: true };
			const s = lifecycle();
			const big = JSON.stringify({ used: 80_000, size: 200_000 });
			const a = await thread({ status: "completed", usage: big });
			s.facts = () => ({ ...qualifying(), compactsWhenIdle: true });
			await s.onSettled(a.id, { outcome: "succeeded" });
			const b = await thread({ status: "completed", usage: JSON.stringify({ used: 1_000, size: 200_000 }) });
			s.facts = qualifying;
			await s.onSettled(b.id, { outcome: "succeeded" });
			const c = await thread({ status: "completed", usage: big });
			s.facts = registryFacts;
			await s.onSettled(c.id, { outcome: "succeeded" });
			expect(await prisma.threadWake.count()).toBe(0);
		});

		it("keeps to three an hour across threads", async () => {
			settings = { harness: "auto", compactIdle: true };
			const last = new Date(2026, 10, 7, 12, 0);
			const s = lifecycle();
			s.facts = qualifying;
			const ids: string[] = [];
			for (let i = 0; i < 4; i++) {
				const t = await thread({ status: "completed", lastActivityAt: last, usage: JSON.stringify({ used: 80_000, size: 200_000 }) });
				ids.push(t.id);
				await s.onSettled(t.id, { outcome: "succeeded" });
			}
			await s.process(new Date(last.getTime() + 56 * 60_000));
			expect(resumed).toHaveLength(3);
			const capped = await prisma.threadWake.findMany({ where: { kind: "idle_compact", state: "skipped" } });
			expect(capped.map((w) => [ids.includes(w.investigationId), JSON.parse(w.payload ?? "{}").skipped])).toEqual([[true, "rate cap"]]);
		});

		it("is skipped when the thread was used since, or settled", async () => {
			settings = { harness: "auto", compactIdle: true };
			const last = new Date(2026, 10, 7, 12, 0);
			const s = lifecycle();
			s.facts = qualifying;
			const used = await thread({ status: "completed", lastActivityAt: last, usage: JSON.stringify({ used: 80_000, size: 200_000 }) });
			await s.onSettled(used.id, { outcome: "succeeded" });
			await prisma.investigation.update({ where: { id: used.id }, data: { lastActivityAt: new Date(last.getTime() + 10 * 60_000) } });
			const settled = await thread({ status: "completed", lastActivityAt: last, usage: JSON.stringify({ used: 80_000, size: 200_000 }) });
			await s.onSettled(settled.id, { outcome: "succeeded" });
			await prisma.investigation.update({ where: { id: settled.id }, data: { settledAt: last } });
			await s.process(new Date(last.getTime() + 56 * 60_000));
			expect(resumed).toEqual([]);
			expect((await wakes.latest(used.id, "idle_compact"))?.payload.skipped).toBe("new activity");
			expect((await wakes.latest(settled.id, "idle_compact"))?.payload.skipped).toBe("settled");
		});
	});

	describe("the session view", () => {
		it("reads unknown without evidence, cold or warm only where the registry knows the TTL, and the last compaction", async () => {
			const last = new Date(2026, 10, 7, 10, 0);
			const t = await thread({ status: "completed", lastActivityAt: last });
			const s = lifecycle(new Date(2026, 10, 7, 13, 0));
			expect(await s.sessionOf(t)).toMatchObject({ cache: "unknown", contextTokens: 12_000, compaction: "none", compactCommand: "compact" });
			s.facts = () => ({ label: "A", cacheTtlMinutes: 60, compactsWhenIdle: false, compactCommand: null });
			expect((await s.sessionOf(t)).cache).toBe("cold");
			s.now = () => new Date(last.getTime() + 10 * 60_000);
			expect((await s.sessionOf(t)).cache).toBe("warm");
			await say(t.id, [{ kind: "compaction", phase: "completed", method: "agent_command", before: 142_000, after: 18_000 }]);
			expect((await s.sessionOf(t)).compaction).toBe("agent_command");
		});
	});
});

const { registryFacts } = await import("./session.js");
