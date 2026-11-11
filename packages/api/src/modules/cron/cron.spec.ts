// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { CronService } from "./cron.service.js";

interface MemCronJob {
	id: string;
	investigationId: string;
	name: string;
	schedule: string;
	prompt: string;
	recurring: boolean;
	nextAt: Date | null;
	expiresAt: Date | null;
	pendingSince: Date | null;
	lastFiredAt: Date | null;
	skipped: number;
	createdAt: Date;
}

interface MemWake {
	id: string;
	investigationId: string;
	kind: string;
	at: Date;
	reason: string;
	payload: Record<string, unknown>;
	state: "pending" | "done" | "cancelled";
	doneAt?: Date;
}

function harness(now: Date = new Date("2026-11-11T12:00:00.000Z")) {
	let idSeq = 1;
	const jobs = new Map<string, MemCronJob>();
	const wakes: MemWake[] = [];
	const threads = new Map<string, { id: string; createdAt: Date; settledAt: Date | null; lastActivityAt: Date | null; updatedAt: Date }>();
	const events: Array<{ investigationId: string; seq: number; event: string }> = [];

	const THREAD = "thread-1";
	threads.set(THREAD, {
		id: THREAD,
		createdAt: new Date(now.getTime() - 24 * 60 * 60_000),
		settledAt: null,
		lastActivityAt: null,
		updatedAt: now,
	});

	const prisma = {
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				const t = threads.get(where.id);
				return t ? { id: t.id, createdAt: t.createdAt } : null;
			}),
		},
		investigationEvent: {
			findMany: vi.fn(async ({ where }: { where: { investigationId: string } }) =>
				events.filter((e) => e.investigationId === where.investigationId),
			),
		},
		threadWake: {
			findMany: vi.fn(async ({ where }: { where: { investigationId: string } }) =>
				wakes.filter((w) => w.investigationId === where.investigationId).map((w) => ({ id: w.id })),
			),
			updateMany: vi.fn(async ({ where, data }: { where: { id?: string; state?: string }; data: { state?: "pending" | "done" | "cancelled"; doneAt?: Date } }) => {
				let count = 0;
				for (const w of wakes) {
					if (where.id && w.id !== where.id) continue;
					if (where.state && w.state !== where.state) continue;
					if (data.state) w.state = data.state;
					if (data.doneAt) w.doneAt = data.doneAt;
					count++;
				}
				return { count };
			}),
		},
		cronJob: {
			count: vi.fn(async ({ where }: { where: { investigationId: string } }) =>
				[...jobs.values()].filter((j) => j.investigationId === where.investigationId).length,
			),
			create: vi.fn(async ({ data }: { data: Omit<MemCronJob, "id" | "pendingSince" | "lastFiredAt" | "skipped" | "createdAt"> }) => {
				const row: MemCronJob = {
					id: `job-${idSeq++}`,
					pendingSince: null,
					lastFiredAt: null,
					skipped: 0,
					createdAt: now,
					...data,
				};
				jobs.set(row.id, row);
				return { ...row };
			}),
			findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
				let list = [...jobs.values()];
				const where = args?.where;
				if (where) {
					if (where.investigationId) list = list.filter((j) => j.investigationId === where.investigationId);
					if (where.nextAt && typeof where.nextAt === "object" && "lte" in where.nextAt) {
						const lte = where.nextAt.lte as Date;
						list = list.filter((j) => j.nextAt !== null && j.nextAt <= lte);
					}
					if (where.pendingSince && typeof where.pendingSince === "object" && "not" in where.pendingSince) {
						list = list.filter((j) => j.pendingSince !== null);
					}
					if (where.OR && Array.isArray(where.OR)) {
						list = list.filter((j) => j.pendingSince !== null || j.nextAt === null);
					}
				}
				return list.map((j) => ({
					...j,
					investigation: {
						settledAt: threads.get(j.investigationId)?.settledAt ?? null,
						lastActivityAt: threads.get(j.investigationId)?.lastActivityAt ?? null,
						updatedAt: threads.get(j.investigationId)?.updatedAt ?? now,
					},
				}));
			}),
			updateMany: vi.fn(async ({ where, data }: { where: { id: string; nextAt?: Date | null; pendingSince?: Date | null }; data: Record<string, unknown> }) => {
				const j = jobs.get(where.id);
				if (!j) return { count: 0 };
				if ("nextAt" in where && where.nextAt !== undefined) {
					const matchTime = where.nextAt?.getTime() ?? null;
					const curTime = j.nextAt?.getTime() ?? null;
					if (matchTime !== curTime) return { count: 0 };
				}
				if ("pendingSince" in where && where.pendingSince !== undefined) {
					const matchTime = where.pendingSince?.getTime() ?? null;
					const curTime = j.pendingSince?.getTime() ?? null;
					if (matchTime !== curTime) return { count: 0 };
				}
				if ("nextAt" in data) j.nextAt = data.nextAt as Date | null;
				if ("pendingSince" in data) j.pendingSince = data.pendingSince as Date | null;
				if ("lastFiredAt" in data) j.lastFiredAt = data.lastFiredAt as Date | null;
				if (data.skipped && typeof data.skipped === "object" && "increment" in data.skipped) {
					j.skipped += (data.skipped as { increment: number }).increment;
				}
				return { count: 1 };
			}),
			deleteMany: vi.fn(async ({ where }: { where: { id?: string; investigationId?: string; nextAt?: null; pendingSince?: null } }) => {
				let count = 0;
				for (const [id, j] of [...jobs.entries()]) {
					if (where.id && j.id !== where.id) continue;
					if (where.investigationId && j.investigationId !== where.investigationId) continue;
					if ("nextAt" in where && where.nextAt === null && j.nextAt !== null) continue;
					if ("pendingSince" in where && where.pendingSince === null && j.pendingSince !== null) continue;
					jobs.delete(id);
					count++;
				}
				return { count };
			}),
		},
		$transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
	};

	let wakeSeq = 1;
	const wakesService = {
		latest: vi.fn(async (threadId: string, kind: string) => {
			const w = [...wakes].reverse().find((x) => x.investigationId === threadId && x.kind === kind);
			return w ? { ...w, payload: { ...w.payload } } : null;
		}),
		schedule: vi.fn(async (threadId: string, kind: string, at: Date, reason: string, payload: Record<string, unknown>) => {
			for (const w of wakes) {
				if (w.investigationId === threadId && w.kind === kind && w.state === "pending") {
					w.state = "cancelled";
				}
			}
			const row: MemWake = {
				id: `wake-${wakeSeq++}`,
				investigationId: threadId,
				kind,
				at,
				reason,
				payload: { ...payload },
				state: "pending",
			};
			wakes.push(row);
			return row.id;
		}),
	};

	const svc = new CronService(prisma as never, wakesService as never);
	return { svc, jobs, wakes, threads, events, THREAD, prisma, wakesService };
}

describe("CronService (#1024 surface F)", () => {
	it("refuses schedule with gap under 60 minutes", async () => {
		const h = harness();
		const res = await h.svc.create(h.THREAD, {
			schedule: "*/30 * * * *",
			prompt: "Check deployment status",
			recurring: true,
		});
		expect(res).toEqual({
			error: "Fires must be at least 60 minutes apart.",
			code: "invalid_input",
			next: "Pass five cron fields in the host's time zone, at least 60 minutes apart.",
		});
	});

	it("refuses a fourth job with limit_reached and delete suggestion", async () => {
		const h = harness();
		for (let i = 1; i <= 3; i++) {
			await h.svc.create(h.THREAD, {
				schedule: `0 ${i + 1} * * *`,
				prompt: `Task ${i}`,
				recurring: true,
			});
		}
		const fourth = await h.svc.create(h.THREAD, {
			schedule: "0 10 * * *",
			prompt: "Task 4",
			recurring: true,
		});
		expect(fourth).toEqual({
			error: "This thread already has 3 cron jobs.",
			code: "limit_reached",
			next: "Delete one with `pl_cron_delete`.",
		});
	});

	it("refuses with disabled when last non-wake operator_message is 8 days old", async () => {
		const t0 = new Date("2026-11-11T12:00:00.000Z");
		const h = harness(t0);
		const thread = h.threads.get(h.THREAD)!;
		thread.createdAt = new Date(t0.getTime() - 10 * 24 * 60 * 60_000);
		h.events.push({
			investigationId: h.THREAD,
			seq: 1,
			event: JSON.stringify({
				kind: "operator_message",
				ts: new Date(t0.getTime() - 8 * 24 * 60 * 60_000).toISOString(),
			}),
		});

		const res = await h.svc.create(
			h.THREAD,
			{ schedule: "0 14 * * *", prompt: "Status check", recurring: true },
			t0,
		);
		expect(res).toEqual({
			error: "The user has not written in this thread for 7 days.",
			code: "disabled",
			next: "Ask the user to keep this running.",
		});
	});

	it("two jobs on the same schedule both become pending in one tick and ride one cron wake with units 2", async () => {
		const t0 = new Date("2026-11-11T10:00:00.000Z");
		const h = harness(t0);
		const job1 = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Run backup", recurring: true }, t0);
		const job2 = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Check health", recurring: true }, t0);
		expect("next" in job1 && "next" in job2).toBe(true);
		if (!("next" in job1 && "next" in job2)) throw new Error("Jobs not created");

		const due = new Date(job1.next);
		await h.svc.tick(due);

		const wake = h.wakes.find((w) => w.kind === "cron" && w.state === "pending");
		expect(wake).toBeDefined();
		expect(wake?.payload.units).toBe(2);
		expect(wake?.payload.from).toBe("cron");
		const carried = wake?.payload.jobs as Array<{ id: string; since: string }>;
		expect(carried.map((j) => j.id).sort()).toEqual(["job-1", "job-2"]);
	});

	it("job A wake sealed, job B comes due, A wake marked done, next sync puts B and only B in a new wake", async () => {
		const t0 = new Date("2026-11-11T08:00:00.000Z");
		const h = harness(t0);
		const jobA = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Job A", recurring: true }, t0);
		expect("next" in jobA).toBe(true);
		if (!("next" in jobA)) throw new Error("Job A not created");

		const dueA = new Date(jobA.next);
		await h.svc.tick(dueA);

		const wakeA = h.wakes.find((w) => w.kind === "cron" && w.state === "pending")!;
		expect(wakeA.payload.units).toBe(1);
		expect((wakeA.payload.jobs as Array<{ id: string }>)[0]?.id).toBe("job-1");

		wakeA.payload.sentTo = "agent-session-1";

		const dueB = new Date(dueA.getTime() + 60 * 60_000);
		const jobB = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Job B", recurring: true }, dueA);
		expect("id" in jobB).toBe(true);

		await h.svc.tick(dueB);
		expect(h.wakes.filter((w) => w.kind === "cron" && w.state === "pending")).toHaveLength(1);

		wakeA.state = "done";
		wakeA.doneAt = dueB;

		await h.svc.sync(h.THREAD, dueB);

		const pendingWakes = h.wakes.filter((w) => w.kind === "cron" && w.state === "pending");
		expect(pendingWakes).toHaveLength(1);
		const wakeB = pendingWakes[0]!;
		expect(wakeB.id).not.toBe(wakeA.id);
		expect(wakeB.payload.units).toBe(1);
		const jobsInWakeB = wakeB.payload.jobs as Array<{ id: string }>;
		expect(jobsInWakeB).toEqual([{ id: "job-2", since: dueB.toISOString() }]);
	});

	it("a one-shot job is deleted after its wake is done", async () => {
		const t0 = new Date("2026-11-11T08:00:00.000Z");
		const h = harness(t0);
		const res = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "One shot report", recurring: false }, t0);
		expect("id" in res).toBe(true);
		if (!("id" in res)) throw new Error("Job not created");

		const due = new Date(res.next);
		await h.svc.tick(due);

		const wake = h.wakes.find((w) => w.kind === "cron" && w.state === "pending")!;
		wake.state = "done";
		wake.doneAt = due;

		await h.svc.sync(h.THREAD, due);
		const remaining = await h.svc.list(h.THREAD);
		expect(remaining).toEqual([]);
	});

	it("a recurring job past expiresAt gets one last fire then is deleted", async () => {
		const t0 = new Date("2026-11-11T08:00:00.000Z");
		const h = harness(t0);
		const res = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Expiring recurring", recurring: true }, t0);
		expect("id" in res).toBe(true);
		if (!("id" in res)) throw new Error("Job not created");

		const job = h.jobs.get(res.id)!;
		const due = new Date(res.next);
		job.expiresAt = new Date(due.getTime() + 30 * 60_000);

		await h.svc.tick(due);

		expect(job.pendingSince).toEqual(due);
		expect(job.nextAt).toBeNull();

		const wake = h.wakes.find((w) => w.kind === "cron" && w.state === "pending")!;
		wake.state = "done";
		wake.doneAt = due;

		await h.svc.sync(h.THREAD, due);
		const remaining = await h.svc.list(h.THREAD);
		expect(remaining).toEqual([]);
	});

	it("a job whose stored nextAt lies past its expiresAt is retired without a fire", async () => {
		const t0 = new Date("2026-11-11T08:00:00.000Z");
		const h = harness(t0);
		const res = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Monthly check", recurring: true }, t0);
		if (!("id" in res)) throw new Error("Job not created");
		const job = h.jobs.get(res.id)!;
		const due = new Date(t0.getTime() + 60 * 60_000);
		job.nextAt = due;
		job.expiresAt = new Date(due.getTime() - 30 * 60_000);

		await h.svc.tick(due);

		expect(job.pendingSince).toBeNull();
		expect(job.nextAt).toBeNull();
		expect(h.wakes.filter((w) => w.kind === "cron")).toEqual([]);
		expect(await h.svc.list(h.THREAD)).toEqual([]);
	});

	it("a job whose nextAt is 5 hours in the past fires once and its next nextAt is after now", async () => {
		const t0 = new Date("2026-11-11T08:00:00.000Z");
		const h = harness(t0);
		const res = await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Hourly job", recurring: true }, t0);
		expect("id" in res).toBe(true);
		if (!("id" in res)) throw new Error("Job not created");

		const job = h.jobs.get(res.id)!;
		const fiveHoursAgo = new Date(t0.getTime() - 5 * 60 * 60_000);
		job.nextAt = fiveHoursAgo;

		await h.svc.tick(t0);

		expect(job.pendingSince).toEqual(t0);
		expect(job.lastFiredAt).toEqual(t0);
		expect(job.nextAt).not.toBeNull();
		expect(job.nextAt!.getTime()).toBeGreaterThan(t0.getTime());
	});

	it("a due job that is already pending increments skipped by 1", async () => {
		const t0 = new Date("2026-11-11T08:00:00.000Z");
		const h = harness(t0);
		await h.svc.create(h.THREAD, { schedule: "0 * * * *", prompt: "Skipped job", recurring: true }, t0);

		const job = h.jobs.get("job-1")!;
		job.pendingSince = new Date("2026-11-11T08:00:00.000Z");
		job.nextAt = new Date("2026-11-11T09:00:00.000Z");
		expect(job.skipped).toBe(0);

		const t9 = new Date("2026-11-11T09:00:00.000Z");
		await h.svc.tick(t9);

		expect(job.skipped).toBe(1);
	});
});
