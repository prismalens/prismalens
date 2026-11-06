// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ThreadFeedQuerySchema } from "@prismalens/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { liveChanges } from "../../core/live/live-changes.js";
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
		$transaction: ReturnType<typeof vi.fn>;
		threadWake: { updateMany: ReturnType<typeof vi.fn> };
		prWatch: { deleteMany: ReturnType<typeof vi.fn> };
		investigation: {
			findMany: ReturnType<typeof vi.fn>;
			findUnique: ReturnType<typeof vi.fn>;
			updateMany: ReturnType<typeof vi.fn>;
		};
		investigationEvent: {
			groupBy: ReturnType<typeof vi.fn>;
			findFirst: ReturnType<typeof vi.fn>;
			findMany: ReturnType<typeof vi.fn>;
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
			{ consume: async () => "none", withDrafts: async () => new Set() } as never,
			{ compose: async () => undefined } as never,
			{ rowGlyphs: async () => new Map() } as never,
		);
	const query = (over: Record<string, unknown> = {}) =>
		ThreadFeedQuerySchema.parse(over);

	beforeEach(() => {
		prisma = {
			$transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
			threadWake: { updateMany: vi.fn(async () => ({ count: 0 })) },
			prWatch: { deleteMany: vi.fn(async () => ({ count: 0 })) },

			investigation: {
				findMany: vi.fn(async () => []),
				findUnique: vi.fn(async () => null),
				updateMany: vi.fn(async () => ({ count: 1 })),
			},
			investigationEvent: {
				groupBy: vi.fn(async () => []),
				findFirst: vi.fn(async () => null),
				findMany: vi.fn(async () => []),
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

	it("a row says what its thread waits on, new and legacy asks alike, and whether it keeps a draft (#1024)", async () => {
		const waiting = run({
			status: "running",
			awaitingApprovalAt: new Date("2026-11-10T11:30:00Z"),
		});
		const quiet = run({});
		prisma.investigation.findMany.mockResolvedValue([waiting, quiet]);
		const base = { runId: waiting.id, branchId: "run", path: [], label: null, ts: "2026-11-10T11:30:00.000Z" };
		const askId = "3f0c9a52-6f42-4c55-9c1a-1d6bb0f4f2a1";
		prisma.investigationEvent.findMany.mockResolvedValue([
			{
				investigationId: waiting.id,
				event: JSON.stringify({ ...base, kind: "permission_ask", seq: 1, askId: "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11", title: "Run kubectl", detail: null, toolKind: "execute", expiresAt: base.ts }),
			},
			{
				investigationId: waiting.id,
				event: JSON.stringify({ ...base, kind: "permission_answer", seq: 2, askId: "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11", outcome: "approved" }),
			},
			{
				investigationId: waiting.id,
				event: JSON.stringify({
					...base,
					kind: "ask_opened",
					seq: 3,
					ask: { askId, threadId: waiting.id, kind: "question", requiresHost: false, source: { kind: "agent" }, title: "Which environment?", openedAt: base.ts },
				}),
			},
		]);
		const drafts = new Set([`thread:${quiet.id}`]);
		const svc = new ThreadsService(
			prisma as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{ withDrafts: async () => drafts } as never,
			{} as never,
			{ rowGlyphs: async () => new Map() } as never,
		);
		const feed = await svc.feed(query(), NOW);
		const rows = feed.units.flatMap((u) => u.threads);
		const byId = new Map(rows.map((r) => [r.id, r]));
		expect(byId.get(waiting.id)?.waitingAsk).toEqual({ kind: "question", title: "Which environment?" });
		expect(byId.get(waiting.id)?.hasDraft).toBe(false);
		expect(byId.get(quiet.id)?.waitingAsk).toBeNull();
		expect(byId.get(quiet.id)?.hasDraft).toBe(true);
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
		const note = vi.spyOn(liveChanges, "noteTopic");
		await service().updateSettings({ settleAfterDays: 5 });
		expect(prisma.setting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ where: { key: "threads.list" } }),
		);
		// Other browsers' thread lists re-read the new quiet days.
		expect(note).toHaveBeenCalledWith("threads");
		note.mockRestore();
	});

	it("marks one thread seen, and refuses an unknown one", async () => {
		const id = uuid();
		const stamp = new Date("2026-01-01T00:00:00Z");
		prisma.investigation.findUnique.mockResolvedValue({ updatedAt: stamp });
		await service().visit(id);
		// Seen state keeps the row's updatedAt, which orders the feed.
		expect(prisma.investigation.updateMany).toHaveBeenCalledWith({
			where: { id, updatedAt: stamp },
			data: { lastVisitedAt: expect.any(Date), updatedAt: stamp },
		});
		prisma.investigation.findUnique.mockResolvedValue(null);
		await expect(service().visit(id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("reports a conflict, not success, when every read-state write loses its race", async () => {
		const id = uuid();
		prisma.investigation.findUnique.mockResolvedValue({
			incidentId: null,
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		});
		prisma.investigation.findMany.mockResolvedValue([{ id, settledAt: null }]);
		prisma.investigation.updateMany.mockResolvedValue({ count: 0 });
		await expect(service().visit(id)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(prisma.investigation.updateMany).toHaveBeenCalledTimes(3);
		await expect(service().settle(id, true)).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("settles an incident's whole block, and undoes it", async () => {
		const inc = uuid();
		const ids = [uuid(), uuid()];
		const stamp = new Date("2026-01-01T00:00:00Z");
		prisma.investigation.findUnique.mockResolvedValue({
			incidentId: inc,
			updatedAt: stamp,
		});
		prisma.investigation.findMany.mockResolvedValue(ids.map((id) => ({ id })));
		expect(await service().settle(ids[0] as string, true)).toMatchObject({ ids });
		expect(prisma.investigation.findMany).toHaveBeenCalledWith({
			where: { incidentId: inc },
			select: { id: true, settledAt: true },
		});
		for (const id of ids)
			expect(prisma.investigation.updateMany).toHaveBeenCalledWith({
				where: { id, updatedAt: stamp },
				data: { settledAt: expect.any(Date), updatedAt: stamp },
			});
		// A bare Undo clears only the thread it names, never its siblings (#1020).
		prisma.investigation.updateMany.mockClear();
		await service().settle(ids[0] as string, false);
		expect(prisma.investigation.updateMany).toHaveBeenCalledTimes(1);
		expect(prisma.investigation.updateMany).toHaveBeenLastCalledWith({
			where: { id: ids[0], updatedAt: stamp },
			data: { settledAt: null, updatedAt: stamp },
		});
		prisma.investigation.findUnique.mockResolvedValue(null);
		await expect(service().settle(uuid(), true)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("Undo puts each thread of an incident block back as it was, an earlier Settle included", async () => {
		const inc = uuid();
		const earlier = new Date("2020-01-01T08:00:00Z");
		const rows = [
			{ id: uuid(), incidentId: inc, settledAt: earlier },
			{ id: uuid(), incidentId: inc, settledAt: null as Date | null },
		];
		prisma.investigation.findUnique.mockImplementation(
			async ({ where }: { where: { id: string } }) => ({
				incidentId: inc,
				settledAt: rows.find((r) => r.id === where.id)?.settledAt ?? null,
			}),
		);
		prisma.investigation.findMany.mockImplementation(async () =>
			rows.map((r) => ({ id: r.id, settledAt: r.settledAt })),
		);
		prisma.investigation.updateMany.mockImplementation(
			async ({ where, data }: { where: { id: string | { in: string[] } }; data: { settledAt: Date | null } }) => {
				const ids = typeof where.id === "string" ? [where.id] : where.id.in;
				for (const r of rows) if (ids.includes(r.id)) r.settledAt = data.settledAt;
				return { count: ids.length };
			},
		);

		const done = await service().settle(rows[1]?.id as string, true);
		expect(rows.every((r) => r.settledAt && r.settledAt > earlier)).toBe(true);
		expect(done.previous).toEqual([
			{ id: rows[0]?.id, settledAt: earlier.toISOString() },
			{ id: rows[1]?.id, settledAt: null },
		]);

		await service().settle(rows[1]?.id as string, false, done.previous);
		expect(rows.map((r) => r.settledAt)).toEqual([earlier, null]);
	});

	it("puts the written threads back when a later one in the block conflicts", async () => {
		const inc = uuid();
		const earlier = new Date("2020-01-01T08:00:00Z");
		const rows = [
			{ id: uuid(), settledAt: earlier as Date | null },
			{ id: uuid(), settledAt: null as Date | null },
		];
		const stamp = new Date("2026-01-01T00:00:00Z");
		prisma.investigation.findUnique.mockImplementation(
			async ({ where }: { where: { id: string } }) => ({
				incidentId: inc,
				updatedAt: stamp,
				settledAt: rows.find((r) => r.id === where.id)?.settledAt ?? null,
			}),
		);
		prisma.investigation.findMany.mockImplementation(async () =>
			rows.map((r) => ({ ...r })),
		);
		prisma.investigation.updateMany.mockImplementation(
			async ({ where, data }: { where: { id: string }; data: { settledAt: Date | null } }) => {
				const r = rows.find((x) => x.id === where.id);
				if (!r || where.id === rows[1]?.id) return { count: 0 };
				r.settledAt = data.settledAt;
				return { count: 1 };
			},
		);
		await expect(service().settle(rows[0]?.id as string, true)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(rows.map((r) => r.settledAt)).toEqual([earlier, null]);
	});

	it("says the block is partly settled when a restore write also conflicts", async () => {
		const inc = uuid();
		const rows = [
			{ id: uuid(), settledAt: null as Date | null },
			{ id: uuid(), settledAt: null as Date | null },
		];
		prisma.investigation.findUnique.mockImplementation(
			async ({ where }: { where: { id: string } }) => ({
				incidentId: inc,
				updatedAt: new Date("2026-01-01T00:00:00Z"),
				settledAt: rows.find((r) => r.id === where.id)?.settledAt ?? null,
			}),
		);
		prisma.investigation.findMany.mockImplementation(async () =>
			rows.map((r) => ({ ...r })),
		);
		let firstWrites = 0;
		prisma.investigation.updateMany.mockImplementation(
			async ({ where, data }: { where: { id: string }; data: { settledAt: Date | null } }) => {
				if (where.id !== rows[0]?.id || firstWrites++ > 0) return { count: 0 };
				(rows[0] as { settledAt: Date | null }).settledAt = data.settledAt;
				return { count: 1 };
			},
		);
		await expect(service().settle(rows[0]?.id as string, true)).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("could not be put back"),
		});
		expect(rows[0]?.settledAt).not.toBeNull();
	});

	it("restores only threads of the block it was asked about", async () => {
		const inc = uuid();
		const own = uuid();
		prisma.investigation.findUnique.mockResolvedValue({ incidentId: inc });
		prisma.investigation.findMany.mockResolvedValue([{ id: own, settledAt: null }]);
		await service().settle(own, false, [
			{ id: uuid(), settledAt: "2026-11-01T00:00:00.000Z" },
		]);
		const calls = prisma.investigation.updateMany.mock.calls.map((c) => c[0]);
		expect(calls).toEqual([]);
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
