// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The scheduler over a temp SQLite database (#979): what the operator asked to see proven.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-schedules-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { PrismaJobStore } = await import("../../infrastructure/dispatch/job-store.js");
const { SchedulesService } = await import("./schedules.service.js");

type Prisma = InstanceType<typeof PrismaService>;
type Gap = { kind: "asleep" | "off"; from: Date; to: Date };

describe("SchedulesService (#979)", () => {
	let prisma: Prisma;
	let serviceId: string;
	const gaps: Gap[] = [];
	const lifecycle = {
		observe: vi.fn(() => null),
		gapCovering: vi.fn((at: Date) => gaps.find((g) => g.from <= at && at <= g.to) ?? null),
	};
	const ready = vi.fn(async () => ({ ready: true as const }));
	const started: string[] = [];

	function scheduler() {
		const store = new PrismaJobStore(prisma.job as never);
		return new SchedulesService(
			prisma,
			{
				startAdmitted: (id: string) => started.push(id),
				expireScheduled: (now: Date) => store.expireScheduled(now),
			} as never,
			{ ensureReady: ready } as never,
			lifecycle as never,
		);
	}

	const input = (over: Record<string, unknown> = {}) => ({
		name: "Morning check",
		serviceId,
		runbook: null,
		brief: "Look at the last 12 hours.",
		recurrence: { type: "cron" as const, expr: "0 9 * * *", timezone: "UTC" },
		harness: "claude-code" as const,
		model: null,
		effort: null,
		missedPolicy: "run_once" as const,
		catchUpMinutes: 360,
		...over,
	});

	async function ticks(scheduleId: string) {
		return prisma.scheduleTick.findMany({ where: { scheduleId }, orderBy: { scheduledFor: "asc" } });
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		const repo = await prisma.repository.create({
			data: { fullName: "org/checkout", sourceKind: "url", url: "https://example.test/checkout.git" },
		});
		const svc = await prisma.service.create({ data: { name: `checkout-${randomUUID()}` } });
		serviceId = svc.id;
		await prisma.serviceRepository.create({
			data: { serviceId, repositoryId: repo.id, isPrimary: true },
		});
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	beforeEach(async () => {
		await prisma.job.deleteMany();
		await prisma.investigation.deleteMany();
		await prisma.schedule.deleteMany();
		gaps.length = 0;
		started.length = 0;
		lifecycle.observe.mockClear();
		ready.mockResolvedValue({ ready: true });
	});

	it("runs once after a sleep that spanned three slots, and says it slept", async () => {
		const s = scheduler();
		const created = await s.create(input(), "host", new Date("2026-05-29T10:00:00Z"));
		gaps.push({ kind: "asleep", from: new Date("2026-05-29T22:00:00Z"), to: new Date("2026-06-01T10:30:00Z") });

		await s.evaluate(new Date("2026-06-01T10:32:00Z"));

		const [tick, ...rest] = await ticks(created.id);
		expect(rest).toEqual([]);
		expect(tick).toMatchObject({ outcome: "late_started", reason: "asleep", missedCount: 2 });
		expect(tick?.scheduledFor).toEqual(new Date("2026-06-01T09:00:00Z"));
		expect(lifecycle.observe).toHaveBeenCalled();
		const job = await prisma.job.findUniqueOrThrow({ where: { investigationId: tick?.investigationId as string } });
		expect(job).toMatchObject({ kind: "scheduled", incidentId: null, priority: 5 });
		expect(job.startBy).toEqual(new Date("2026-06-01T15:00:00Z"));
		expect(JSON.parse(job.payload)).toMatchObject({ unattended: true, accessLevel: "auto", incidentId: null });
		expect(started).toEqual([tick?.investigationId]);
		const row = await prisma.schedule.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.nextRunAt).toEqual(new Date("2026-06-02T09:00:00Z"));
	});

	it("skips a tick while the last run is still going, and never runs two at once", async () => {
		const s = scheduler();
		const created = await s.create(input(), "host", new Date("2026-06-02T08:00:00Z"));
		await s.evaluate(new Date("2026-06-02T09:00:10Z"));
		const [first] = await ticks(created.id);
		await prisma.job.updateMany({ data: { status: "running", claimedBy: "o" } });
		await prisma.investigation.update({ where: { id: first?.investigationId as string }, data: { status: "running" } });

		await s.evaluate(new Date("2026-06-03T09:00:10Z"));

		const all = await ticks(created.id);
		expect(all.map((t) => t.outcome)).toEqual(["started", "skipped_overlap"]);
		expect(await prisma.investigation.count({ where: { scheduleId: created.id } })).toBe(1);
		await expect(s.runNow(created.id, "host", new Date("2026-06-03T10:00:00Z"))).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("loses nothing and doubles nothing when it crashes while admitting a run", async () => {
		const created = await scheduler().create(input(), "host", new Date("2026-06-04T08:00:00Z"));
		const crash = vi.spyOn(PrismaJobStore.prototype, "enqueue").mockRejectedValueOnce(new Error("killed"));
		await scheduler().evaluate(new Date("2026-06-04T09:00:05Z"));
		crash.mockRestore();
		expect(await ticks(created.id)).toEqual([]);
		expect(await prisma.investigation.count({ where: { scheduleId: created.id } })).toBe(0);

		// PrismaLens starts again: a fresh scheduler admits the slot exactly once.
		await scheduler().evaluate(new Date("2026-06-04T09:00:40Z"));
		await scheduler().evaluate(new Date("2026-06-04T09:01:10Z"));
		expect((await ticks(created.id)).map((t) => t.outcome)).toEqual(["started"]);
		expect(await prisma.job.count({ where: { kind: "scheduled" } })).toBe(1);
	});

	it("never fires a decided slot again after a restart cuts its run off", async () => {
		const created = await scheduler().create(input(), "host", new Date("2026-06-05T08:00:00Z"));
		await scheduler().evaluate(new Date("2026-06-05T09:00:05Z"));
		const store = new PrismaJobStore(prisma.job as never);
		await prisma.job.updateMany({ data: { status: "running", claimedBy: "old-process" } });
		const failed = await store.failRunning("API restarted while the run was in flight");
		await prisma.investigation.updateMany({ where: { id: { in: failed } }, data: { status: "failed" } });

		await scheduler().evaluate(new Date("2026-06-05T09:01:00Z"));
		expect((await ticks(created.id)).map((t) => t.outcome)).toEqual(["started"]);

		await scheduler().evaluate(new Date("2026-06-06T09:00:05Z"));
		expect((await ticks(created.id)).map((t) => t.outcome)).toEqual(["started", "started"]);
	});

	it("moves a run in the spring gap to the first valid time, and runs a repeated hour once", async () => {
		const s = scheduler();
		const spring = await s.create(
			input({ recurrence: { type: "cron", expr: "30 2 * * *", timezone: "America/New_York" } }),
			"host",
			new Date("2026-03-07T12:00:00Z"),
		);
		await s.evaluate(new Date("2026-03-08T07:00:20Z"));
		expect((await ticks(spring.id)).map((t) => t.scheduledFor.toISOString())).toEqual(["2026-03-08T07:00:00.000Z"]);

		const fall = await s.create(
			input({ recurrence: { type: "cron", expr: "30 1 * * *", timezone: "America/New_York" } }),
			"host",
			new Date("2026-10-31T12:00:00Z"),
		);
		for (const at of ["2026-11-01T05:30:20Z", "2026-11-01T06:30:20Z", "2026-11-01T07:00:00Z"]) {
			await prisma.investigation.updateMany({ where: { scheduleId: fall.id }, data: { status: "completed" } });
			await s.evaluate(new Date(at));
		}
		expect((await ticks(fall.id)).map((t) => t.scheduledFor.toISOString())).toEqual(["2026-11-01T05:30:00.000Z"]);
	});

	it("records a miss past the catch-up window, and skips an agent that cannot run", async () => {
		const s = scheduler();
		const created = await s.create(input(), "host", new Date("2026-06-07T08:00:00Z"));
		gaps.push({ kind: "off", from: new Date("2026-06-07T08:30:00Z"), to: new Date("2026-06-07T16:00:00Z") });
		await s.evaluate(new Date("2026-06-07T16:00:00Z"));
		ready.mockResolvedValue({ ready: false, reason: "Claude Code: sign-in needed" } as never);
		await s.evaluate(new Date("2026-06-08T09:00:05Z"));
		expect((await ticks(created.id)).map((t) => [t.outcome, t.reason])).toEqual([
			["missed_off", "off"],
			["skipped_agent_not_ready", "Claude Code: sign-in needed"],
		]);
	});

	it("lets an edit that lands first win, and refuses a stale one", async () => {
		const s = scheduler();
		const created = await s.create(input(), "host", new Date("2026-06-09T08:00:00Z"));
		await s.update(created.id, created.revision, input({ name: "Renamed" }), "host", new Date("2026-06-09T08:30:00Z"));
		await expect(s.update(created.id, created.revision, input(), "host")).rejects.toMatchObject({ code: "CONFLICT" });
		const events = await prisma.scheduleEvent.findMany({ where: { scheduleId: created.id }, orderBy: { createdAt: "asc" } });
		expect(events.map((e) => e.action)).toEqual(["created", "edited"]);
	});

	it("skips and pauses when the service's repositories changed under the schedule", async () => {
		const s = scheduler();
		const created = await s.create(input(), "host", new Date("2026-06-10T08:00:00Z"));
		const extra = await prisma.repository.create({
			data: { fullName: "org/other", sourceKind: "url", url: "https://example.test/other.git" },
		});
		const link = await prisma.serviceRepository.create({ data: { serviceId, repositoryId: extra.id } });
		await s.evaluate(new Date("2026-06-10T09:00:05Z"));
		await prisma.serviceRepository.delete({ where: { id: link.id } });
		expect((await ticks(created.id)).map((t) => t.outcome)).toEqual(["skipped_bindings_changed"]);
		const row = await prisma.schedule.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.enabled).toBe(false);
		expect(row.pausedReason).toMatch(/repositories or notes changed/);
	});

	it("expires a run no slot took before its deadline, as host-busy", async () => {
		const s = scheduler();
		const created = await s.create(input({ missedPolicy: "skip" }), "host", new Date("2026-06-11T08:00:00Z"));
		await s.evaluate(new Date("2026-06-11T09:00:05Z"));
		await s.evaluate(new Date("2026-06-11T09:16:00Z"));
		const [tick] = await ticks(created.id);
		expect(tick?.outcome).toBe("expired_host_busy");
		const run = await prisma.investigation.findUniqueOrThrow({ where: { id: tick?.investigationId as string } });
		expect(run.status).toBe("cancelled");
	});

	it("pauses after three failed runs in a row at the current revision", async () => {
		const s = scheduler();
		const created = await s.create(input(), "host", new Date("2026-06-12T08:00:00Z"));
		for (const day of ["12", "13", "14"]) {
			await s.evaluate(new Date(`2026-06-${day}T09:00:05Z`));
			await prisma.investigation.updateMany({ where: { scheduleId: created.id }, data: { status: "failed" } });
		}
		await s.evaluate(new Date("2026-06-14T09:30:00Z"));
		const row = await prisma.schedule.findUniqueOrThrow({ where: { id: created.id } });
		expect(row).toMatchObject({ enabled: false, pausedReason: "Paused after three failed runs in a row." });
	});
});
