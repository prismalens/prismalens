// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AUTONOMOUS_TURNS_PER_DAY, type WakeKind } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { CEILING_LINE, SessionLifecycleService } from "./session-lifecycle.service.js";
import { WakesService } from "./wakes.service.js";

interface MemInvestigation {
	id: string;
	status: string;
	kind: string;
	harness: string | null;
	usage: string | null;
	report: string | null;
	workspace: string | null;
	endReason: string | null;
	error: string | null;
	lastActivityAt: Date | null;
	updatedAt: Date;
	completedAt: Date | null;
	limitResetsAt: Date | null;
	autoResume: boolean | null;
	settledAt: Date | null;
	teardownAt: Date | null;
	autoPause: string | null;
}

interface MemThreadWake {
	id: string;
	investigationId: string;
	kind: string;
	at: Date;
	reason: string;
	payload: string;
	state: "pending" | "done" | "cancelled" | "skipped";
	attempts: number;
	doneAt: Date | null;
	createdAt: Date;
}

interface MemCronJob {
	id: string;
	investigationId: string;
	name: string;
}

function harness(baseNow: Date = new Date("2026-11-11T12:00:00.000Z"), inboxStub?: unknown) {
	let wakeSeq = 1;
	const now = new Date(baseNow);
	const investigations = new Map<string, MemInvestigation>();
	const wakes = new Map<string, MemThreadWake>();
	const cronJobs = new Map<string, MemCronJob>();
	const events: Array<{ investigationId: string; body: Record<string, unknown> }> = [];

	const prisma = {
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				const inv = investigations.get(where.id);
				return inv ? { ...inv } : null;
			}),
			updateMany: vi.fn(async ({ where, data }: { where: { id: string; autoPause?: string | null }; data: Partial<MemInvestigation> }) => {
				const inv = investigations.get(where.id);
				if (!inv) return { count: 0 };
				if (where.autoPause !== undefined && inv.autoPause !== where.autoPause) return { count: 0 };
				Object.assign(inv, data);
				return { count: 1 };
			}),
		},
		threadWake: {
			findMany: vi.fn(async (args?: {
				where?: Record<string, unknown>;
				orderBy?: Array<{ at?: "asc" | "desc"; id?: "asc" | "desc" }> | { at?: "asc"; id?: "asc" };
				take?: number;
			}) => {
				let list = [...wakes.values()];
				const w = args?.where;
				if (w) {
					if (w.investigationId) list = list.filter((x) => x.investigationId === w.investigationId);
					if (w.kind && typeof w.kind === "object" && "in" in (w.kind as { in: string[] })) {
						const allowed = (w.kind as { in: string[] }).in;
						list = list.filter((x) => allowed.includes(x.kind));
					} else if (typeof w.kind === "string") {
						list = list.filter((x) => x.kind === w.kind);
					}
					if (w.state) list = list.filter((x) => x.state === w.state);
					if (w.at && typeof w.at === "object" && "lte" in (w.at as { lte: Date })) {
						const lte = (w.at as { lte: Date }).lte;
						list = list.filter((x) => x.at <= lte);
					}
					if (Array.isArray(w.OR)) {
						const branches = w.OR as Array<Record<string, unknown>>;
						list = list.filter((x) =>
							branches.some((branch) => {
								if (branch.state && x.state !== branch.state) return false;
								if (branch.doneAt && typeof branch.doneAt === "object" && "gte" in (branch.doneAt as { gte: Date })) {
									const gte = (branch.doneAt as { gte: Date }).gte;
									if (!x.doneAt || x.doneAt < gte) return false;
								}
								if (branch.at && typeof branch.at === "object" && "gt" in (branch.at as { gt: Date })) {
									const gt = (branch.at as { gt: Date }).gt;
									if (x.at <= gt) return false;
								}
								if (branch.at && branch.at instanceof Date && branch.id && typeof branch.id === "object" && "gt" in (branch.id as { gt: string })) {
									const gt = (branch.id as { gt: string }).gt;
									if (x.at.getTime() !== (branch.at as Date).getTime() || x.id <= gt) return false;
								}
								return true;
							}),
						);
					}
				}
				list.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
				if (args?.take) list = list.slice(0, args.take);
				return list.map((x) => ({ ...x }));
			}),
			findFirst: vi.fn(async ({ where, orderBy }: { where?: { investigationId?: string; kind?: string }; orderBy?: { createdAt: "desc" } }) => {
				let list = [...wakes.values()];
				if (where?.investigationId) list = list.filter((w) => w.investigationId === where.investigationId);
				if (where?.kind) list = list.filter((w) => w.kind === where.kind);
				if (orderBy?.createdAt === "desc") {
					list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
				}
				const first = list[0];
				return first ? { ...first } : null;
			}),
			create: vi.fn(async ({ data }: { data: Omit<MemThreadWake, "id" | "doneAt" | "createdAt"> }) => {
				const id = `wake-${wakeSeq++}`;
				const row: MemThreadWake = {
					id,
					doneAt: null,
					createdAt: now,
					...data,
				};
				wakes.set(id, row);
				return { ...row };
			}),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemThreadWake> }) => {
				const w = wakes.get(where.id);
				if (!w) throw new Error(`Wake ${where.id} not found`);
				Object.assign(w, data);
				return { ...w };
			}),
			updateMany: vi.fn(async ({ where, data }: { where: { investigationId?: string; kind?: string; state?: string; id?: string }; data: Partial<MemThreadWake> }) => {
				let count = 0;
				for (const w of wakes.values()) {
					if (where.investigationId && w.investigationId !== where.investigationId) continue;
					if (where.kind && w.kind !== where.kind) continue;
					if (where.state && w.state !== where.state) continue;
					if (where.id && w.id !== where.id) continue;
					Object.assign(w, data);
					count++;
				}
				return { count };
			}),
		},
		cronJob: {
			create: vi.fn(async ({ data }: { data: { investigationId: string; name: string } }) => {
				const id = `cron-${cronJobs.size + 1}`;
				const job: MemCronJob = { id, ...data };
				cronJobs.set(id, job);
				return job;
			}),
			deleteMany: vi.fn(async ({ where }: { where: { investigationId?: string } }) => {
				let count = 0;
				for (const [id, j] of cronJobs.entries()) {
					if (!where.investigationId || j.investigationId === where.investigationId) {
						cronJobs.delete(id);
						count++;
					}
				}
				return { count };
			}),
		},
		setting: {
			findUnique: vi.fn(async () => null),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
	};

	const wakesSvc = new WakesService(prisma as never);

	const dispatch = {
		sendMessage: vi.fn((_threadId: string, _text: string, _mode: string, _files: unknown, _u: unknown, _wakeId: string) => "queued"),
		resumeInvestigation: vi.fn(async (_threadId: string, _text: string, _mode: string, _kind: string, _files: unknown, _opts: unknown, _u: unknown, session?: { wakeId?: string; wakeDoneAt?: Date }) => {
			if (session?.wakeId) {
				await wakesSvc.finish(session.wakeId, "done", undefined, session.wakeDoneAt ?? now);
			}
			return true;
		}),
	};

	const harnessSettings = { autoResume: true, compactIdle: false };
	const harnessMock = {
		getSettings: vi.fn(async () => harnessSettings),
	};

	const investigationsSvc = {
		lastEventSeq: vi.fn(async (id: string) => {
			return events.filter((e) => e.investigationId === id).length;
		}),
		appendEvents: vi.fn(async (id: string, evts: Array<Record<string, unknown>>) => {
			for (const e of evts) {
				events.push({ investigationId: id, body: e });
			}
		}),
		allEvents: vi.fn(async (id: string) =>
			events
				.filter((e) => e.investigationId === id)
				.map((e, idx) => ({ seq: idx + 1, ts: now.toISOString(), ...e.body })),
		),
		recordEvent: vi.fn(async (id: string, body: Record<string, unknown>) => {
			events.push({ investigationId: id, body });
		}),
	};

	const svc = new SessionLifecycleService(
		prisma as never,
		wakesSvc,
		dispatch as never,
		harnessMock as never,
		investigationsSvc as never,
		inboxStub as never,
	);
	svc.now = () => now;

	return {
		svc,
		wakesSvc,
		prisma,
		dispatch,
		harnessMock,
		harnessSettings,
		investigationsSvc,
		investigations,
		wakes,
		cronJobs,
		events,
		now,
		seedThread: (id: string, over: Partial<MemInvestigation> = {}) => {
			const thread: MemInvestigation = {
				id,
				status: "completed",
				kind: "chat",
				harness: "mock",
				usage: null,
				report: null,
				workspace: null,
				endReason: null,
				error: null,
				lastActivityAt: now,
				updatedAt: now,
				completedAt: now,
				limitResetsAt: null,
				autoResume: true,
				settledAt: null,
				teardownAt: null,
				autoPause: null,
				...over,
			};
			investigations.set(id, thread);
			return thread;
		},
		seedWake: async (
			threadId: string,
			kind: WakeKind,
			over: {
				at?: Date;
				reason?: string;
				payload?: Record<string, unknown>;
				state?: "pending" | "done" | "cancelled" | "skipped";
				doneAt?: Date | null;
				createdAt?: Date;
			} = {},
		) => {
			const id = `wake-${wakeSeq++}`;
			const row: MemThreadWake = {
				id,
				investigationId: threadId,
				kind,
				at: over.at ?? now,
				reason: over.reason ?? `wake ${kind}`,
				payload: JSON.stringify(over.payload ?? {}),
				state: over.state ?? "pending",
				attempts: 1,
				doneAt: over.doneAt !== undefined ? over.doneAt : (over.state === "done" ? now : null),
				createdAt: over.createdAt ?? new Date(now.getTime() + wakeSeq * 1000),
			};
			wakes.set(id, row);
			return row;
		},
	};
}

describe("SessionLifecycleService Ceiling and holds (#1024 surface F)", () => {
	it("13 autonomous units in 24 h, mixing pr_status wakes queued into a running thread (sentTo, admittedAt set), resumed ones (state: done, doneAt), and cron wakes: 12 admitted, the 13th held pending, the thread's autoPause is {reason: 'ceiling'} and the event text is exactly Paused automatic updates: 12 in the last day. Your next message releases them.", async () => {
		const h = harness();
		const threadId = "thread-ceiling-13";
		h.seedThread(threadId, { status: "running" });

		const within24h = new Date(h.now.getTime() - 2 * 60 * 60_000);

		// 4 units from queued pr_status wakes (state: pending, admittedAt set)
		for (let i = 1; i <= 4; i++) {
			await h.seedWake(threadId, "pr_status", {
				state: "pending",
				payload: { sentTo: threadId, admittedAt: within24h.toISOString(), units: 1 },
			});
		}
		// 4 units from resumed pr_status wakes (state: done, doneAt set)
		for (let i = 1; i <= 4; i++) {
			await h.seedWake(threadId, "pr_status", {
				state: "done",
				doneAt: within24h,
				payload: { units: 1 },
			});
		}
		// 4 units from cron wakes (state: done, doneAt set)
		for (let i = 1; i <= 4; i++) {
			await h.seedWake(threadId, "cron", {
				state: "done",
				doneAt: within24h,
				payload: { units: 1 },
			});
		}

		// 12 autonomous units admitted in the last 24h
		const used = await h.wakesSvc.autonomousUnits(threadId, new Date(h.now.getTime() - 24 * 60 * 60_000));
		expect(used).toBe(12);

		// The 13th wake comes due
		const dueWake = await h.seedWake(threadId, "pr_status", {
			at: h.now,
			state: "pending",
			payload: { units: 1 },
		});

		await h.svc.process(h.now);

		// 13th held pending
		const rowAfter = h.wakes.get(dueWake.id);
		expect(rowAfter?.state).toBe("pending");
		const wakePayload = JSON.parse(rowAfter?.payload ?? "{}");
		expect(wakePayload.admittedAt).toBeUndefined();

		// autoPause is { reason: "ceiling", ... }
		const thread = h.investigations.get(threadId);
		expect(JSON.parse(thread?.autoPause ?? "{}")).toMatchObject({ reason: "ceiling" });

		// Event text matches CEILING_LINE exactly
		const ev = h.events.find((e) => e.investigationId === threadId && e.body.kind === "auto_paused");
		expect(ev?.body.text).toBe("Paused automatic updates: 12 in the last day. Your next message releases them.");
		expect(ev?.body.text).toBe(CEILING_LINE);
	});

	it("A wake created 25 hours ago and admitted now counts now; a cron wake with units: 3 counts 3; deleting and recreating cron jobs does not change the count; agent and pr_watch wakes are not counted and still fire", async () => {
		const h = harness();
		const threadId = "thread-counts";
		h.seedThread(threadId, { status: "completed" });

		const twentyFiveHoursAgo = new Date(h.now.getTime() - 25 * 60 * 60_000);
		const since = new Date(h.now.getTime() - 24 * 60 * 60_000);

		// A wake created 25 hours ago and admitted now counts now
		const oldWake = await h.seedWake(threadId, "pr_status", {
			createdAt: twentyFiveHoursAgo,
			state: "done",
			doneAt: h.now,
			payload: { units: 1 },
		});
		expect(oldWake.doneAt?.toISOString()).toBe(h.now.toISOString());
		let count = await h.wakesSvc.autonomousUnits(threadId, since);
		expect(count).toBe(1);

		// A cron wake with units: 3 counts 3
		await h.seedWake(threadId, "cron", {
			state: "done",
			doneAt: h.now,
			payload: { units: 3 },
		});
		count = await h.wakesSvc.autonomousUnits(threadId, since);
		expect(count).toBe(4);

		// Deleting and recreating cron jobs does not change the count
		await h.prisma.cronJob.create({ data: { investigationId: threadId, name: "nightly check" } });
		await h.prisma.cronJob.deleteMany({ where: { investigationId: threadId } });
		await h.prisma.cronJob.create({ data: { investigationId: threadId, name: "nightly check 2" } });
		count = await h.wakesSvc.autonomousUnits(threadId, since);
		expect(count).toBe(4);

		// Fill up to ceiling of 12
		await h.seedWake(threadId, "pr_status", {
			state: "done",
			doneAt: h.now,
			payload: { units: 8 },
		});
		count = await h.wakesSvc.autonomousUnits(threadId, since);
		expect(count).toBe(12);

		// agent and pr_watch wakes are not counted and still fire
		const agentWake = await h.seedWake(threadId, "agent", { at: h.now, state: "pending" });
		const prWatchWake = await h.seedWake(threadId, "pr_watch", { at: h.now, state: "pending" });

		await h.svc.process(h.now);

		expect(h.wakes.get(agentWake.id)?.state).toBe("done");
		expect(h.wakes.get(prWatchWake.id)?.state).toBe("done");
	});

	it("Two process() calls started together never admit past 12", async () => {
		const h = harness();
		const threadId = "thread-concurrent";
		h.seedThread(threadId, { status: "completed" });

		const within24h = new Date(h.now.getTime() - 60 * 60_000);
		// Pre-fill 11 units
		await h.seedWake(threadId, "pr_status", {
			state: "done",
			doneAt: within24h,
			payload: { units: 11 },
		});

		// 2 wakes due now, each units: 1
		const wakeA = await h.seedWake(threadId, "pr_status", { at: h.now, state: "pending", payload: { units: 1 } });
		const wakeB = await h.seedWake(threadId, "cron", { at: h.now, state: "pending", payload: { units: 1 } });

		// Start two process() calls concurrently
		await Promise.all([h.svc.process(h.now), h.svc.process(h.now)]);

		const states = [h.wakes.get(wakeA.id)?.state, h.wakes.get(wakeB.id)?.state];
		expect(states).toContain("done");
		expect(states).toContain("pending");

		const count = await h.wakesSvc.autonomousUnits(threadId, new Date(h.now.getTime() - 24 * 60 * 60_000));
		expect(count).toBe(AUTONOMOUS_TURNS_PER_DAY);
		expect(count).toBe(12);
	});

	it("An operator_message event from the user after autoPause.since clears a ceiling pause on the next pass; a loop_guard pause is not cleared by a message", async () => {
		const h = harness();
		const threadId = "thread-pause-clearing";
		const pausedAt = new Date(h.now.getTime() - 30 * 60_000);

		// 1. Ceiling pause
		h.seedThread(threadId, {
			status: "completed",
			autoPause: JSON.stringify({ reason: "ceiling", since: pausedAt.toISOString() }),
		});

		// Due wake pending
		const dueWake = await h.seedWake(threadId, "pr_status", { at: h.now, state: "pending", payload: { units: 1 } });

		// Process without user message: pause holds wake
		await h.svc.process(h.now);
		expect(h.wakes.get(dueWake.id)?.state).toBe("pending");

		// User sends message after autoPause.since
		const messageTime = new Date(h.now.getTime() - 10 * 60_000);
		h.events.push({
			investigationId: threadId,
			body: { kind: "operator_message", ts: messageTime.toISOString() },
		});

		// Next pass clears ceiling pause and admits the wake
		await h.svc.process(h.now);
		expect(h.investigations.get(threadId)?.autoPause).toBeNull();
		expect(h.wakes.get(dueWake.id)?.state).toBe("done");

		// 2. Loop guard pause
		const loopGuardThreadId = "thread-loop-guard";
		h.seedThread(loopGuardThreadId, {
			status: "completed",
			autoPause: JSON.stringify({ reason: "loop_guard", prId: "pr-1", since: pausedAt.toISOString() }),
		});
		h.events.push({
			investigationId: loopGuardThreadId,
			body: { kind: "operator_message", ts: messageTime.toISOString() },
		});
		const loopDueWake = await h.seedWake(loopGuardThreadId, "pr_status", { at: h.now, state: "pending", payload: { units: 1 } });

		await h.svc.process(h.now);
		// loop_guard pause is not cleared by message
		expect(h.investigations.get(loopGuardThreadId)?.autoPause).not.toBeNull();
		expect(JSON.parse(h.investigations.get(loopGuardThreadId)?.autoPause ?? "{}")).toMatchObject({ reason: "loop_guard" });
		expect(h.wakes.get(loopDueWake.id)?.state).toBe("done"); // other PR status still go when loop guard pauses one PR
	});

	it("A thread with a pending limit wake, or a skipped one with gaveUp: true, admits no pr_status or cron turn while it is not running (wake stays pending), with auto-resume on and off; once the limit wake is cancelled (a turn succeeded) the held wake is admitted", async () => {
		const h = harness();
		const threadId = "thread-limit-hold";
		h.seedThread(threadId, { status: "completed", autoResume: true });

		// 1. Pending limit wake with autoResume: true
		const limitWake = await h.seedWake(threadId, "limit", { state: "pending", at: new Date(h.now.getTime() + 60_000) });
		const prWake = await h.seedWake(threadId, "pr_status", { state: "pending", at: h.now, payload: { units: 1 } });

		await h.svc.process(h.now);
		expect(h.wakes.get(prWake.id)?.state).toBe("pending");

		// 2. Pending limit wake with autoResume: false
		h.investigations.get(threadId)!.autoResume = false;
		await h.svc.process(h.now);
		expect(h.wakes.get(prWake.id)?.state).toBe("pending");

		// 3. Skipped limit wake with gaveUp: true
		h.wakes.get(limitWake.id)!.state = "skipped";
		h.wakes.get(limitWake.id)!.payload = JSON.stringify({ noTime: true, gaveUp: true });
		await h.svc.process(h.now);
		expect(h.wakes.get(prWake.id)?.state).toBe("pending");

		// 4. Once limit wake is cancelled (turn succeeded), held wake is admitted
		h.wakes.get(limitWake.id)!.state = "pending";
		await h.svc.onSettled(threadId, { outcome: "succeeded" });
		expect(h.wakes.get(limitWake.id)?.state).toBe("cancelled");

		await h.svc.process(h.now);
		expect(h.wakes.get(prWake.id)?.state).toBe("done");
	});

	it("A settled thread with teardownAt set: no wake of any kind fires (all stay pending)", async () => {
		const h = harness();
		const threadId = "thread-settled-window";
		const settledAt = new Date(h.now.getTime() - 60_000);
		const lastActivityAt = new Date(h.now.getTime() - 120_000);
		const teardownAt = new Date(h.now.getTime() + 60_000);

		h.seedThread(threadId, {
			status: "completed",
			settledAt,
			lastActivityAt,
			updatedAt: lastActivityAt,
			teardownAt,
		});

		const kinds: WakeKind[] = ["agent", "pr_watch", "pr_status", "cron", "limit"];
		const createdIds: string[] = [];
		for (const kind of kinds) {
			const w = await h.seedWake(threadId, kind, { at: h.now, state: "pending" });
			createdIds.push(w.id);
		}

		await h.svc.process(h.now);

		// All wakes stay pending
		for (const id of createdIds) {
			expect(h.wakes.get(id)?.state).toBe("pending");
		}
	});

	it("a due agent wake on a failed thread under a limit stays pending and dispatch.resumeInvestigation is not called", async () => {
		const inbox = {
			providerStop: vi.fn(async () => ({ mode: "usage_limit" as const })),
			arrived: vi.fn(async () => {}),
			failed: vi.fn(async () => {}),
		};
		const h = harness(undefined, inbox);
		const threadId = "thread-agent-limited";
		h.seedThread(threadId, { status: "failed" });
		const agentWake = await h.seedWake(threadId, "agent", {
			state: "pending",
			at: h.now,
		});

		await h.svc.process(h.now);

		expect(h.wakes.get(agentWake.id)?.state).toBe("pending");
		expect(h.dispatch.resumeInvestigation).not.toHaveBeenCalled();
	});

	it("a due limit wake with two queued tree messages calls resumeInvestigation whose text ends with those two lines in order and session has claims and delivers containing both", async () => {
		const queued = [
			{ id: "t1", text: "[FROM db #2] result: one" },
			{ id: "t2", text: "[FROM api #3] result: two" },
		];
		const inbox = {
			queuedTree: vi.fn(async () => queued),
			providerStop: vi.fn(async () => null),
			arrived: vi.fn(async () => {}),
		};
		const h = harness(undefined, inbox);
		const threadId = "thread-limit-tree";
		h.seedThread(threadId, { status: "failed", autoResume: true });
		await h.seedWake(threadId, "limit", {
			state: "pending",
			at: h.now,
			payload: { mode: "usage_limit" },
		});

		await h.svc.process(h.now);

		expect(h.dispatch.resumeInvestigation).toHaveBeenCalledTimes(1);
		const call = h.dispatch.resumeInvestigation.mock.calls[0];
		const text = call[1] as string;
		const session = call[7] as { claims?: string[]; delivers?: string[] };
		expect(
			text.endsWith(
				"[FROM db #2] result: one\n\n[FROM api #3] result: two",
			),
		).toBe(true);
		expect(session.claims).toEqual(["t1", "t2"]);
		expect(session.delivers).toContain("t1");
		expect(session.delivers).toContain("t2");
	});
});
