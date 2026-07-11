// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "./settings.service.js";

describe("SettingsService", () => {
	let service: SettingsService;

	const mockPrisma = {
		setting: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
		},
		$transaction: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({
			providers: [
				SettingsService,
				{ provide: PrismaService, useValue: mockPrisma },
			],
		}).compile();

		service = moduleRef.get(SettingsService);
	});

	describe("getInvestigationPolicies", () => {
		it("should return policies including new trigger fields at seed defaults when no saved row", async () => {
			mockPrisma.setting.findUnique.mockResolvedValue(null);

			const { policies } = await service.getInvestigationPolicies();
			const tier1 = policies.find((p) => p.tier === "tier_1");

			expect(tier1).toBeDefined();
			expect(tier1?.triggerOnAlertCount).toBe(3);
			expect(tier1?.triggerOnSeverities).toEqual(["critical", "high"]);
			expect(tier1?.triggerDelayMinutes).toBe(2);
		});

		it("should merge saved row with new defaults (backward compat)", async () => {
			const savedPolicies = {
				tier_1: { autoInvestigate: "manual" },
			};
			mockPrisma.setting.findUnique.mockResolvedValue({
				value: JSON.stringify(savedPolicies),
			});

			const { policies } = await service.getInvestigationPolicies();
			const tier1 = policies.find((p) => p.tier === "tier_1");

			expect(tier1).toBeDefined();
			expect(tier1?.autoInvestigate).toBe("manual");
			expect(tier1?.triggerOnAlertCount).toBe(3); // from default
		});
	});

	describe("updateInvestigationPolicy", () => {
		it("should persist a passed trigger field", async () => {
			mockPrisma.setting.findUnique.mockResolvedValue(null);

			await service.updateInvestigationPolicy("tier_1", {
				triggerOnAlertCount: 42,
			});

			expect(mockPrisma.setting.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					update: expect.objectContaining({
						value: expect.stringContaining('"triggerOnAlertCount":42'),
					}),
				}),
			);
		});
	});
});
