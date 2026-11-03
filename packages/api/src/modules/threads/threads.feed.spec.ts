// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ThreadFeedQuerySchema } from "@prismalens/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadsService } from "./threads.service.js";

const NOW = new Date("2026-11-10T12:00:00Z");
let n = 0;
const uuid = () =>
	`00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const incident = (over: Record<string, unknown> = {}) => ({
	id: uuid(),
	number: 7,
	title: "Checkout slow",
	severity: "high",
	status: "investigating",
	closedAt: null,
	service: { name: "checkout-api", displayName: null },
	...over,
});

const run = (over: Record<string, unknown> = {}) => ({
	id: uuid(),
	incidentId: null,
	serviceId: null,
	scheduleId: null,
	repositoryId: null,
	status: "completed",
	kind: "chat",
	title: "A thread",
	accessLevel: null,
	harness: null,
	model: null,
	effort: null,
	startedAt: null,
	completedAt: null,
	rootCause: null,
	error: null,
	awaitingApprovalAt: null,
	lastTurnOutcome: "answered",
	lastVisitedAt: new Date("2026-11-10T11:59:00Z"),
	settledAt: null,
	origin: "local",
	schemaVersion: 1,
	createdAt: new Date("2026-11-10T11:00:00Z"),
	updatedAt: new Date("2026-11-10T11:00:00Z"),
	incident: null,
	repository: null,
	service: null,
	...over,
});

describe("ThreadsService feed, visit, settle (#1020)", () => {
	let prisma: {
		investigation: {
			findMany: ReturnType<typeof vi.fn>;
			findUnique: ReturnType<typeof vi.fn>;
			updateMany: ReturnType<typeof vi.fn>;
		};
		investigationEvent: {
			groupBy: ReturnType<typeof vi.fn>;
			findFirst: ReturnType<typeof vi.fn>;
		};
		setting: {
			findUnique: ReturnType<typeof vi.fn>;
			upsert: ReturnType<typeof vi.fn>;
		};
	};
	const service = () =>
		new ThreadsService(
			prisma as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
		);
	const query = (over: Record<string, unknown> = {}) =>
		ThreadFeedQuerySchema.parse(over);

	beforeEach(() => {
		prisma = {
			investigation: {
				findMany: vi.fn(async () => []),
				findUnique: vi.fn(async () => null),
				updateMany: vi.fn(async () => ({ count: 1 })),
			},
			investigationEvent: {
				groupBy: vi.fn(async () => []),
				findFirst: vi.fn(async () => null),
			},
			setting: {
				findUnique: vi.fn(async () => null),
				upsert: vi.fn(async () => ({})),
			},
		};
	});

	it("lists every subject in sections, Needs you first, with counts", async () => {
		const inc = incident();
		const ask = run({
			status: "running",
			kind: "investigation",
			incidentId: inc.id,
			incident: inc,
			awaitingApprovalAt: new Date("2026-11-10T11:30:00Z"),
		});
		const project = run({
			repositoryId: uuid(),
			repository: {
				sourceKind: "url",
				url: "https://github.com/acme/shop",
				fullName: "acme/shop",
			},
		});
		const old = run({ createdAt: new Date("2026-11-01T00:00:00Z") });
		prisma.investigation.findMany.mockResolvedValue([project, old, ask]);
		const feed = await service().feed(query(), NOW);
		expect(feed.units.map((u) => [u.section, u.threads[0]?.id])).toEqual([
			["needs", ask.id],
			["active", project.id],
			["settled", old.id],
		]);
		expect(feed.counts).toEqual({ needs: 1, active: 1, settled: 1 });
		expect(feed.units[0]?.incident).toMatchObject({
			number: 7,
			severity: "high",
		});
		expect(feed.units[0]?.threads[0]?.serviceName).toBe("checkout-api");
		expect(feed.units[1]?.threads[0]?.projectName).toBe("acme/shop");
	});

	it("pages an incident's threads as one unit", async () => {
		const inc = incident();
		const a = run({ incidentId: inc.id, incident: inc, kind: "investigation" });
		const b = run({ incidentId: inc.id, incident: inc });
		const c = run({ createdAt: new Date("2026-11-10T10:00:00Z") });
		prisma.investigation.findMany.mockResolvedValue([a, c, b]);
		const first = await service().feed(query({ limit: 1 }), NOW);
		expect(first.units).toHaveLength(1);
		expect(first.units[0]?.threads.map((t) => t.id).sort()).toEqual(
			[a.id, b.id].sort(),
		);
		expect(first.nextCursor).toBe(1);
		const second = await service().feed(query({ limit: 1, cursor: 1 }), NOW);
		expect(second.units[0]?.threads.map((t) => t.id)).toEqual([c.id]);
		expect(second.nextCursor).toBeNull();
	});

	it("counts the last event as activity, so a settled thread wakes", async () => {
		const t = run({
			settledAt: new Date("2026-11-10T11:10:00Z"),
			lastVisitedAt: new Date("2026-11-10T11:58:00Z"),
		});
		prisma.investigation.findMany.mockResolvedValue([t]);
		expect((await service().feed(query(), NOW)).units[0]?.section).toBe(
			"settled",
		);
		prisma.investigationEvent.groupBy.mockResolvedValue([
			{
				investigationId: t.id,
				_max: { createdAt: new Date("2026-11-10T11:20:00Z") },
			},
		]);
		expect((await service().feed(query(), NOW)).units[0]?.section).toBe(
			"active",
		);
	});

	it("filters by section and time, and searches titles, names and INC numbers", async () => {
		const quiet = run({ createdAt: new Date("2026-11-01T00:00:00Z") });
		const fresh = run();
		prisma.investigation.findMany.mockResolvedValue([fresh, quiet]);
		const settled = await service().feed(query({ section: "settled" }), NOW);
		expect(settled.units.map((u) => u.threads[0]?.id)).toEqual([quiet.id]);
		expect(settled.counts.active).toBe(1);
		const recent = await service().feed(
			query({ since: "2026-11-09T00:00:00Z" }),
			NOW,
		);
		expect(recent.units.map((u) => u.threads[0]?.id)).toEqual([fresh.id]);

		await service().feed(query({ search: "INC-7", kind: "investigation" }), NOW);
		const where = prisma.investigation.findMany.mock.calls.at(-1)?.[0].where;
		expect(where.kind).toBe("investigation");
		expect(where.OR).toContainEqual({ title: { contains: "INC-7" } });
		expect(where.OR).toContainEqual({
			incident: {
				is: {
					OR: [{ title: { contains: "INC-7" } }, { number: 7 }],
				},
			},
		});
	});

	it("reads the quiet days from settings, defaulting to 3", async () => {
		expect(await service().getSettings()).toEqual({ settleAfterDays: 3 });
		prisma.setting.findUnique.mockResolvedValue({
			value: JSON.stringify({ settleAfterDays: 30 }),
		});
		const quiet = run({ createdAt: new Date("2026-11-01T00:00:00Z") });
		prisma.investigation.findMany.mockResolvedValue([quiet]);
		expect((await service().feed(query(), NOW)).units[0]?.section).toBe(
			"active",
		);
		prisma.setting.findUnique.mockResolvedValue({ value: "not json" });
		expect(await service().getSettings()).toEqual({ settleAfterDays: 3 });
		await service().updateSettings({ settleAfterDays: 5 });
		expect(prisma.setting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ where: { key: "threads.list" } }),
		);
	});

	it("marks one thread seen, and refuses an unknown one", async () => {
		const id = uuid();
		await service().visit(id);
		expect(prisma.investigation.updateMany).toHaveBeenCalledWith({
			where: { id },
			data: { lastVisitedAt: expect.any(Date) },
		});
		prisma.investigation.updateMany.mockResolvedValue({ count: 0 });
		await expect(service().visit(id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("settles an incident's whole block, and undoes it", async () => {
		const inc = uuid();
		const ids = [uuid(), uuid()];
		prisma.investigation.findUnique.mockResolvedValue({ incidentId: inc });
		prisma.investigation.findMany.mockResolvedValue(ids.map((id) => ({ id })));
		expect(await service().settle(ids[0] as string, true)).toEqual({ ids });
		expect(prisma.investigation.findMany).toHaveBeenCalledWith({
			where: { incidentId: inc },
			select: { id: true },
		});
		expect(prisma.investigation.updateMany).toHaveBeenLastCalledWith({
			where: { id: { in: ids } },
			data: { settledAt: expect.any(Date) },
		});
		await service().settle(ids[0] as string, false);
		expect(prisma.investigation.updateMany).toHaveBeenLastCalledWith({
			where: { id: { in: ids } },
			data: { settledAt: null },
		});
		prisma.investigation.findUnique.mockResolvedValue(null);
		await expect(service().settle(uuid(), true)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("shows the agent's latest sentence as the row's third line", async () => {
		const t = run({ status: "running" });
		prisma.investigation.findMany.mockResolvedValue([t]);
		prisma.investigationEvent.findFirst.mockResolvedValue({
			investigationId: t.id,
			event: JSON.stringify({ kind: "agent_step", text: "Reading retry.ts" }),
		});
		const feed = await service().feed(query(), NOW);
		expect(feed.units[0]?.threads[0]?.latestText).toBe("Reading retry.ts");
	});
});
