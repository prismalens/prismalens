// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `DispatchService.onModuleInit` — the boot-time sweep that replaces reclaim
 * (0005 §2: one process, no reclaim). A `running` row left behind by a prior
 * process's abrupt exit is failed, never rerun, before the loop starts.
 */
import { describe, expect, it, vi } from "vitest";
import { DispatchService, resolveHarnessRunModel } from "./dispatch.service.js";

type Row = Record<string, unknown>;

/** A minimal in-memory Prisma `job` delegate — just enough for failRunning + an empty claim. */
class FakeJobDelegate {
	rows: Row[];
	constructor(rows: Row[]) {
		this.rows = rows;
	}
	async create() {
		throw new Error("not used");
	}
	async findMany(args: unknown): Promise<Row[]> {
		const where = (args as { where?: Row }).where ?? {};
		return this.rows.filter((r) =>
			Object.entries(where).every(([k, v]) => r[k] === v),
		);
	}
	async findUnique(args?: unknown): Promise<Row | null> {
		const where = (args as { where?: Row } | undefined)?.where ?? {};
		return (
			this.rows.find((r) =>
				Object.entries(where).every(([k, v]) => r[k] === v),
			) ?? null
		);
	}
	async updateMany(args: unknown): Promise<{ count: number }> {
		const a = args as { where: Row; data: Row };
		const targets = this.rows.filter((r) =>
			Object.entries(a.where).every(([k, v]) => r[k] === v),
		);
		for (const row of targets) Object.assign(row, a.data);
		return { count: targets.length };
	}
}

function fakePrisma(rows: Row[]) {
	return { job: new FakeJobDelegate(rows) } as unknown as import("../../core/prisma/prisma.service.js").PrismaService;
}

function fakeBus() {
	return { publish: vi.fn(() => 0), subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) };
}

describe("DispatchService.onModuleInit", () => {
	it("fails every row left `running` by a prior process, and marks the investigation failed too", async () => {
		const rows: Row[] = [
			{
				id: "job-1",
				kind: "investigation",
				investigationId: "inv-1",
				incidentId: "inc-1",
				payload: "{}",
				priority: 3,
				attempts: 1,
				status: "running",
				claimedBy: "old-owner",
			},
		];
		const investigationsService = {
			findById: vi.fn(async () => null),
			updateStatusInternal: vi.fn(async () => null),
			appendEvents: vi.fn(async () => ({ inserted: 0, duplicates: 0 })),
			clearEvents: vi.fn(async () => 0),
			writeResultWithRelations: vi.fn(async () => null),
		};
		const streamRelay = { attach: vi.fn() };
		const incidentsService = { findById: vi.fn(async () => null) };
		const timelineService = { create: vi.fn(async () => ({})) };
		const harnessService = {
			resolveSelection: vi.fn(async () => ({
				runnable: false,
				failure: "no-harness",
				reason: "No coding agent found on PATH.",
			})),
			getSettings: vi.fn(async () => ({ harness: "auto" })),
		};
		const repoSource = { snapshot: vi.fn() };
		const integrationsService = { getIntegrationsByConnectionIds: vi.fn(async () => []) };

		const service = new DispatchService(
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			streamRelay as any,
			investigationsService as any,
			incidentsService as any,
			timelineService as any,
			harnessService as any,
			repoSource as any,
			fakePrisma(rows),
			integrationsService as any,
			{ resolve: vi.fn(async () => []) } as any,
			{ assemble: vi.fn(async () => null) } as any,
			{ capture: vi.fn(), captureFinished: vi.fn() } as any,
			{ deliver: vi.fn() } as any,
		);

		await service.onModuleInit();

		expect(rows[0].status).toBe("failed");
		expect(investigationsService.updateStatusInternal).toHaveBeenCalledWith(
			"inv-1",
			"failed",
			undefined,
			"API restarted while the run was in flight",
		);

		await service.onApplicationShutdown();
	});

	it("does nothing extra when nothing was left running", async () => {
		const investigationsService = {
			findById: vi.fn(async () => null),
			updateStatusInternal: vi.fn(async () => null),
			appendEvents: vi.fn(async () => ({ inserted: 0, duplicates: 0 })),
			clearEvents: vi.fn(async () => 0),
			writeResultWithRelations: vi.fn(async () => null),
		};
		const streamRelay = { attach: vi.fn() };
		const service = new DispatchService(
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			streamRelay as any,
			investigationsService as any,
			{ findById: vi.fn(async () => null) } as any,
			{ create: vi.fn(async () => ({})) } as any,
			{
				resolveSelection: vi.fn(async () => ({
					runnable: false,
					failure: "no-harness",
					reason: "No coding agent found on PATH.",
				})),
				getSettings: vi.fn(async () => ({ harness: "auto" })),
			} as any,
			{ snapshot: vi.fn() } as any,
			fakePrisma([]),
			{ getIntegrationsByConnectionIds: vi.fn(async () => []) } as any,
			{ resolve: vi.fn(async () => []) } as any,
			{ assemble: vi.fn(async () => null) } as any,
			{ capture: vi.fn(), captureFinished: vi.fn() } as any,
			{ deliver: vi.fn() } as any,
		);

		await service.onModuleInit();

		expect(investigationsService.updateStatusInternal).not.toHaveBeenCalled();

		await service.onApplicationShutdown();
	});
});

describe("resolveHarnessRunModel (#634, #639)", () => {
	it("resolves a model and its source for a harness that can take one", () => {
		expect(resolveHarnessRunModel("opencode", "synthetic/model-a")).toEqual({
			model: "synthetic/model-a",
			modelSource: "operator",
		});
	});

	it("claims no model and no source for a modelVia: unsupported harness", () => {
		expect(resolveHarnessRunModel("gemini", undefined)).toEqual({});
	});
});

describe("DispatchService.resumeInvestigation (#747)", () => {
	function withInvestigation(row: Row, jobs: Row[] = []) {
		const investigation = {
			findUnique: vi.fn(async () => ({ ...row })),
			updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
				if (row.status !== args.where.status) return { count: 0 };
				Object.assign(row, args.data);
				return { count: 1 };
			}),
			update: vi.fn(async (args: { data: Row }) => Object.assign(row, args.data)),
		};
		const prisma = { job: new FakeJobDelegate(jobs), investigation };
		const service = new DispatchService(
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			{ attach: vi.fn() } as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			prisma as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{ deliver: vi.fn() } as any,
		);
		const enqueue = vi.spyOn(service, "addInvestigationJob").mockResolvedValue("job-2");
		return { service, enqueue };
	}

	it("reopens a finished run as pending, clears completedAt, and queues the follow-up with what to put back", async () => {
		const completedAt = new Date("2026-09-30T10:00:00.000Z");
		const row: Row = { incidentId: "inc-1", status: "completed", completedAt, error: null };
		const { service, enqueue } = withInvestigation(row);

		expect(await service.resumeInvestigation("inv-1", "why the pool?", "queue")).toBe(true);

		expect(row).toMatchObject({ status: "pending", completedAt: null });
		expect(enqueue).toHaveBeenCalledWith({
			incidentId: "inc-1",
			investigationId: "inv-1",
			resume: {
				text: "why the pool?",
				mode: "queue",
				restore: { status: "completed", completedAt: completedAt.toISOString(), error: null },
			},
		});
	});

	it("keeps the mode the run ran in, and drops a queued legacy access so the row's default applies (#673 w21)", async () => {
		const ran: Row = { incidentId: "inc-1", status: "completed", completedAt: null, error: null, agentMode: "acceptEdits" };
		const kept = withInvestigation(ran);
		await kept.service.resumeInvestigation("inv-1", "and now?", "queue");
		expect(kept.enqueue).toHaveBeenCalledWith(expect.objectContaining({ agentMode: "acceptEdits" }));

		const legacy: Row = { incidentId: "inc-1", status: "completed", completedAt: null, error: null, agentMode: null };
		const job = { investigationId: "inv-1", payload: JSON.stringify({ incidentId: "inc-1", investigationId: "inv-1", access: "workspace-write" }) };
		const dropped = withInvestigation(legacy, [job]);
		await dropped.service.resumeInvestigation("inv-1", "and now?", "queue");
		expect(dropped.enqueue).toHaveBeenCalledWith(expect.not.objectContaining({ agentMode: expect.anything() }));
	});

	it("admits one of two follow-ups sent together", async () => {
		const row: Row = { incidentId: "inc-1", status: "failed", completedAt: null, error: "boom" };
		const { service, enqueue } = withInvestigation(row);

		const results = await Promise.all([
			service.resumeInvestigation("inv-1", "a", "queue"),
			service.resumeInvestigation("inv-1", "b", "queue"),
		]);

		expect(results.filter(Boolean)).toHaveLength(1);
		expect(enqueue).toHaveBeenCalledTimes(1);
	});
});

describe("DispatchService.restoreFollowUp (#752)", () => {
	const completedAt = "2026-09-30T10:00:00.000Z";
	const followUp = {
		incidentId: "inc-1",
		investigationId: "inv-1",
		resume: {
			text: "why the pool?",
			mode: "queue",
			restore: { status: "completed", completedAt, error: null },
		},
	};

	function build(jobs: Row[]) {
		const row: Row = { id: "inv-1", status: "running", completedAt: null, error: null };
		const investigation = {
			update: vi.fn(async (args: { data: Row }) => Object.assign(row, args.data)),
		};
		const investigationsService = {
			updateStatusInternal: vi.fn(async () => null),
			lastEventSeq: vi.fn(async () => 41),
			appendEvents: vi.fn(async () => ({ inserted: 2, duplicates: 0 })),
		};
		const service = new DispatchService(
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			{ attach: vi.fn() } as any,
			investigationsService as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{ job: new FakeJobDelegate(jobs), investigation } as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{ deliver: vi.fn() } as any,
		);
		return { service, row, investigationsService };
	}

	it("a follow-up cut off by a restart puts the finished run back, not failed", async () => {
		const { service, row, investigationsService } = build([
			{
				id: "job-1",
				investigationId: "inv-1",
				incidentId: "inc-1",
				payload: JSON.stringify(followUp),
				status: "running",
			},
		]);
		vi.spyOn(service["dispatcher"], "start").mockImplementation(() => {});

		await service.onModuleInit();

		expect(row).toMatchObject({ status: "completed", error: null });
		expect((row.completedAt as Date).toISOString()).toBe(completedAt);
		expect(investigationsService.updateStatusInternal).not.toHaveBeenCalled();
		const [, events] = investigationsService.appendEvents.mock.calls[0] as unknown as [
			string,
			Array<Row>,
		];
		expect(events.map((e) => [e.kind, e.seq])).toEqual([
			["operator_message", 42],
			["error", 43],
		]);
		expect(events[0]).toMatchObject({ text: "why the pool?", delivered: false });
	});

	it("leaves a first run alone", async () => {
		const { service, row } = build([
			{
				id: "job-1",
				investigationId: "inv-1",
				payload: JSON.stringify({ incidentId: "inc-1", investigationId: "inv-1" }),
				status: "cancelled",
			},
		]);

		expect(await service.restoreFollowUp("inv-1", "stopped")).toBe(false);
		expect(row.status).toBe("running");
	});
});
