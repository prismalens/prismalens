// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { GitCredentialService } from "../integrations/git-credential.service.js";
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
		const controller = new ServicesController(
			mockServicesService as unknown as ServicesService,
			{ preview: vi.fn() } as unknown as GitCredentialService,
		);
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

describe("ServicesService.claimWaiting (#673 w5-10)", () => {
	function claimWith(
		incidents: Array<{ id: string; alerts: Array<{ id: string; labels: string | null }> }>,
	) {
		const prisma = {
			incident: { findMany: vi.fn(async () => incidents), update: vi.fn(async (a: unknown) => a) },
			alert: { updateMany: vi.fn(async (a: unknown) => a) },
			timelineEntry: { create: vi.fn(async (a: unknown) => a) },
			$transaction: vi.fn(async (ops: unknown[]) => ops),
		};
		return { prisma, service: new ServicesService(prisma as unknown as PrismaService) };
	}
	const svc = { id: "svc-1", name: "booklogr-api" };

	it("claims a waiting incident whose alerts' service label names the new service, and only its alerts", async () => {
		const { prisma, service } = claimWith([
			{ id: "inc-1", alerts: [{ id: "a1", labels: '{"alertname":"P99","service":"booklogr-api"}' }, { id: "a2", labels: null }] },
		]);

		expect(await service.claimWaiting(svc)).toBe(1);

		expect(prisma.incident.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ serviceId: null, mergedIntoId: null, status: { not: "closed" } }),
			}),
		);
		expect(prisma.incident.update).toHaveBeenCalledWith({ where: { id: "inc-1" }, data: { serviceId: "svc-1" } });
		expect(prisma.alert.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ["a1"] }, serviceId: null },
			data: { serviceId: "svc-1" },
		});
		expect(prisma.timelineEntry.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ incidentId: "inc-1", title: "Moved to booklogr-api: its alert's service label names it" }),
			}),
		);
	});

	it("leaves an incident whose labels name another service, or none of its alerts names this one", async () => {
		const { prisma, service } = claimWith([
			{ id: "near", alerts: [{ id: "a1", labels: '{"service":"booklogr-api-v2"}' }] },
			{ id: "split", alerts: [{ id: "a2", labels: '{"service":"booklogr-api"}' }, { id: "a3", labels: '{"service":"other"}' }] },
			{ id: "manual", alerts: [] },
		]);

		expect(await service.claimWaiting(svc)).toBe(0);
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("never fails the service save it follows", async () => {
		const prisma = {
			service: { create: vi.fn(async () => ({ id: "svc-1", name: "booklogr-api" })) },
			incident: { findMany: vi.fn(async () => Promise.reject(new Error("db locked"))) },
		};
		const service = new ServicesService(prisma as unknown as PrismaService);
		await expect(service.create({ name: "booklogr-api" } as never)).resolves.toMatchObject({ id: "svc-1" });
	});
});
