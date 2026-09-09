// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `DispatchService.onModuleInit` — the boot-time sweep that replaces reclaim
 * (0005 §2: one process, no reclaim). A `running` row left behind by a prior
 * process's abrupt exit is failed, never rerun, before the loop starts.
 */
import { describe, expect, it, vi } from "vitest";
import { DispatchService } from "./dispatch.service.js";

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
	async findUnique() {
		return null;
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
		const llmSettingsService = {
			resolveActiveLlmConfig: vi.fn(async () => ({
				provider: null,
				model: null,
				baseUrl: null,
				harness: "auto",
			})),
			resolveApiKey: vi.fn(() => null),
		};
		const integrationsService = { getIntegrationsByConnectionIds: vi.fn(async () => []) };
		const servicesService = { findAll: vi.fn(async () => ({ data: [], total: 0 })) };

		const service = new DispatchService(
			fakePrisma(rows),
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			streamRelay as any,
			investigationsService as any,
			incidentsService as any,
			timelineService as any,
			llmSettingsService as any,
			integrationsService as any,
			servicesService as any,
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
			fakePrisma([]),
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			streamRelay as any,
			investigationsService as any,
			{ findById: vi.fn(async () => null) } as any,
			{ create: vi.fn(async () => ({})) } as any,
			{
				resolveActiveLlmConfig: vi.fn(async () => ({
					provider: null,
					model: null,
					baseUrl: null,
					harness: "auto",
				})),
				resolveApiKey: vi.fn(() => null),
			} as any,
			{ getIntegrationsByConnectionIds: vi.fn(async () => []) } as any,
			{ findAll: vi.fn(async () => ({ data: [], total: 0 })) } as any,
		);

		await service.onModuleInit();

		expect(investigationsService.updateStatusInternal).not.toHaveBeenCalled();

		await service.onApplicationShutdown();
	});
});
