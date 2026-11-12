// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageQuery } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { UsageController } from "./usage.controller.js";
import type { UsageService } from "./usage.service.js";

type Callable = {
	"~orpc": { handler: (o: { input: unknown }) => unknown };
};
const call = (r: unknown, input?: unknown) =>
	(r as Callable)["~orpc"].handler({ input });

function store() {
	const rows = new Map<string, { value: string }>();
	return {
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
				const r = rows.get(where.key);
				return r ? { key: where.key, ...r } : null;
			}),
			upsert: vi.fn(
				async ({
					where,
					create,
					update,
				}: {
					where: { key: string };
					create: { value: string };
					update: { value: string };
				}) => {
					rows.set(where.key, { value: update?.value ?? create.value });
				},
			),
		},
		rows,
	};
}

describe("UsageController", () => {
	it("summary passes its input to usage.summary and returns its value", async () => {
		const expectedSummary = {
			range: "7d" as const,
			since: "2026-11-05T00:00:00.000Z",
			until: "2026-11-12T00:00:00.000Z",
			step: "day" as const,
			totals: {
				turns: 1,
				tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
				cost: { amount: 0.01, currency: "USD", unpricedTurns: 0 },
			},
			threads: 1,
			days: [],
			models: [],
			projects: [],
			agents: ["codex"],
			silentAgents: [],
		};
		const usage = {
			summary: vi.fn(async (_input: UsageQuery) => expectedSummary),
			limits: vi.fn(),
			enforcement: vi.fn(),
		};
		const db = store();
		const controller = new UsageController(usage as unknown as UsageService, db as never);
		const input: UsageQuery = { range: "7d", project: "p1" };

		const result = await call(controller.routes().summary, input);
		expect(usage.summary).toHaveBeenCalledWith(input);
		expect(result).toEqual(expectedSummary);
	});

	it("limits and enforcement return the service's value", async () => {
		const expectedLimits = {
			agents: [{ agent: "codex", windows: [] }],
		};
		const expectedEnforcement = {
			rows: [
				{
					agent: "codex",
					access: "supervised",
					fidelity: "enforced" as const,
					mechanism: "sandbox" as const,
					runs: 3,
					lastAt: "2026-11-12T10:00:00.000Z",
				},
			],
		};
		const usage = {
			summary: vi.fn(),
			limits: vi.fn(async () => expectedLimits),
			enforcement: vi.fn(async () => expectedEnforcement),
		};
		const db = store();
		const controller = new UsageController(usage as unknown as UsageService, db as never);

		const limitsResult = await call(controller.routes().limits);
		expect(usage.limits).toHaveBeenCalledTimes(1);
		expect(limitsResult).toEqual(expectedLimits);

		const enforcementResult = await call(controller.routes().enforcement);
		expect(usage.enforcement).toHaveBeenCalledTimes(1);
		expect(enforcementResult).toEqual(expectedEnforcement);
	});

	it("shortcuts.get returns {keys:{}} with no row", async () => {
		const db = store();
		const controller = new UsageController({} as never, db as never);

		const result = await call(controller.shortcuts().get);
		expect(result).toEqual({ keys: {} });
	});

	it("shortcuts.update with {keys:{search:\"Mod+J\"}} returns it and a following get returns it", async () => {
		const db = store();
		const controller = new UsageController({} as never, db as never);
		const next = { keys: { search: "Mod+J" } };

		const updateResult = await call(controller.shortcuts().update, next);
		expect(updateResult).toEqual({ keys: { search: "Mod+J" } });

		const getResult = await call(controller.shortcuts().get);
		expect(getResult).toEqual({ keys: { search: "Mod+J" } });
	});
});
