// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { ServicesService } from "./services.service.js";

function serviceWith(teams: Array<string | null>) {
	const findMany = vi.fn(async () => teams.map((team) => ({ team })));
	const service = new ServicesService({
		service: { findMany },
	} as unknown as PrismaService);
	return { service, findMany };
}

describe("ServicesService.listTeams (#325)", () => {
	it("asks the database for distinct, non-null teams in order", async () => {
		const { service, findMany } = serviceWith(["platform", "payments"]);

		await service.listTeams();

		expect(findMany).toHaveBeenCalledWith({
			where: { team: { not: null } },
			distinct: ["team"],
			select: { team: true },
			orderBy: { team: "asc" },
		});
	});

	it("drops blank and whitespace-only team names", async () => {
		const { service } = serviceWith(["platform", "   ", "", null, "payments"]);

		expect(await service.listTeams()).toEqual(["platform", "payments"]);
	});

	it("returns nothing when no service carries a team", async () => {
		const { service } = serviceWith([]);

		expect(await service.listTeams()).toEqual([]);
	});
});

describe("ServicesController metadata.investigation.notes validation (#673 w21)", () => {
	it("rejects metadata.investigation.notes over 4096 chars on create and update", async () => {
		const { ServicesController } = await import("./services.controller.js");
		const mockServicesService = {
			findByName: vi.fn().mockResolvedValue(null),
			create: vi.fn(),
			update: vi.fn(),
		};
		const controller = new ServicesController(mockServicesService as unknown as ServicesService);
		// biome-ignore lint/suspicious/noExplicitAny: oRPC handler extraction
		const procs = controller.services() as Record<string, any>;
		const createHandler = procs.create["~orpc"].handler;
		const updateHandler = procs.update["~orpc"].handler;

		const longNotes = "a".repeat(4097);
		const validNotes = "a".repeat(4096);

		await expect(
			createHandler({
				input: {
					name: "test-service",
					metadata: { investigation: { notes: longNotes } },
				},
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringMatching(/4096/),
		});

		await expect(
			updateHandler({
				input: {
					id: "srv-1",
					metadata: { investigation: { notes: longNotes } },
				},
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringMatching(/4096/),
		});

		// 4096 characters passes
		mockServicesService.create.mockResolvedValueOnce({
			id: "srv-1",
			name: "test-service",
			type: "service",
			tier: "tier_3",
			metadata: JSON.stringify({ investigation: { notes: validNotes } }),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await expect(
			createHandler({
				input: {
					name: "test-service",
					metadata: { investigation: { notes: validNotes } },
				},
			}),
		).resolves.toBeDefined();
	});
});
