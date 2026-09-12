// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The rule editor, health report and "Alert mapping issues" card are deferred
 * along with the correlation module (prismalens/prismalens#608, C5 on #337).
 * All that remains is `resolveServiceForAlert`'s exact-match lookup.
 */
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { AlertMappingService } from "./alert-mapping.service.js";

const mockPrisma = {
	service: { findUnique: vi.fn() },
};

describe("AlertMappingService.resolveServiceForAlert", () => {
	let service: AlertMappingService;

	beforeEach(async () => {
		vi.clearAllMocks();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AlertMappingService,
				{ provide: PrismaService, useValue: mockPrisma },
			],
		}).compile();

		service = module.get<AlertMappingService>(AlertMappingService);
	});

	it("returns null when the alert carries no service label", async () => {
		const result = await service.resolveServiceForAlert({ title: "No label" });

		expect(result).toBeNull();
		expect(mockPrisma.service.findUnique).not.toHaveBeenCalled();
	});

	it("returns null when the label matches no service by exact name", async () => {
		mockPrisma.service.findUnique.mockResolvedValue(null);

		const result = await service.resolveServiceForAlert({
			title: "Unmapped",
			labels: { service: "checkout-legacy" },
		});

		expect(result).toBeNull();
		expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({
			where: { name: "checkout-legacy" },
		});
	});

	it("returns the service on an exact label match", async () => {
		const checkout = { id: "svc-1", name: "checkout" };
		mockPrisma.service.findUnique.mockResolvedValue(checkout);

		const result = await service.resolveServiceForAlert({
			title: "High CPU",
			labels: { service: "checkout" },
		});

		expect(result).toBe(checkout);
		expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({
			where: { name: "checkout" },
		});
	});

	it("does not fall back to a contains match — 'checkout-legacy' must not resolve to 'checkout'", async () => {
		mockPrisma.service.findUnique.mockResolvedValue(null);

		await service.resolveServiceForAlert({
			title: "High CPU",
			labels: { service: "checkout-legacy" },
		});

		expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({
			where: { name: "checkout-legacy" },
		});
		expect(mockPrisma.service.findUnique).not.toHaveBeenCalledWith({
			where: { name: "checkout" },
		});
	});
});
