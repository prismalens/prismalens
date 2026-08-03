// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { UsersService } from "../../core/users/users.service.js";
import { DevSeedService } from "./dev-seed.service.js";

const mockSeedDemoData = vi.fn();

vi.mock("@prismalens/database", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@prismalens/database")>();
	return {
		...actual,
		seedDemoData: (...args: unknown[]) => mockSeedDemoData(...args),
	};
});

describe("DevSeedService", () => {
	let service: DevSeedService;
	let originalEnv: string | undefined;
	let originalSeedFlag: string | undefined;

	const mockUsersService = {
		isSetupComplete: vi.fn(),
		setupOwner: vi.fn(),
	};

	const mockPrisma = {
		alert: {
			count: vi.fn(),
		},
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		originalEnv = process.env.NODE_ENV;
		originalSeedFlag = process.env.PRISMALENS_SEED_DEMO;

		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({
			providers: [
				DevSeedService,
				{ provide: UsersService, useValue: mockUsersService },
				{ provide: PrismaService, useValue: mockPrisma },
			],
		}).compile();

		service = moduleRef.get(DevSeedService);
	});

	afterEach(() => {
		process.env.NODE_ENV = originalEnv;
		process.env.PRISMALENS_SEED_DEMO = originalSeedFlag;
	});

	it("seeds owner user and demo data when in development mode and DB is empty", async () => {
		process.env.NODE_ENV = "development";
		delete process.env.PRISMALENS_SEED_DEMO;

		mockUsersService.isSetupComplete.mockResolvedValue(false);
		mockPrisma.alert.count.mockResolvedValue(0);

		await service.onApplicationBootstrap();

		expect(mockUsersService.setupOwner).toHaveBeenCalledWith({
			email: "admin@prismalens.dev",
			password: "admin123",
			name: "Admin",
		});
		expect(mockSeedDemoData).toHaveBeenCalledWith(mockPrisma);
	});

	it("seeds demo data when PRISMALENS_SEED_DEMO=1 even if NODE_ENV is production", async () => {
		process.env.NODE_ENV = "production";
		process.env.PRISMALENS_SEED_DEMO = "1";

		mockUsersService.isSetupComplete.mockResolvedValue(false);
		mockPrisma.alert.count.mockResolvedValue(0);

		await service.onApplicationBootstrap();

		expect(mockUsersService.setupOwner).toHaveBeenCalled();
		expect(mockSeedDemoData).toHaveBeenCalledWith(mockPrisma);
	});

	it("does NOT seed anything when NODE_ENV is production and PRISMALENS_SEED_DEMO is unset", async () => {
		process.env.NODE_ENV = "production";
		delete process.env.PRISMALENS_SEED_DEMO;

		await service.onApplicationBootstrap();

		expect(mockUsersService.isSetupComplete).not.toHaveBeenCalled();
		expect(mockUsersService.setupOwner).not.toHaveBeenCalled();
		expect(mockPrisma.alert.count).not.toHaveBeenCalled();
		expect(mockSeedDemoData).not.toHaveBeenCalled();
	});

	it("does NOT seed owner or demo data when data already exists", async () => {
		process.env.NODE_ENV = "development";

		mockUsersService.isSetupComplete.mockResolvedValue(true);
		mockPrisma.alert.count.mockResolvedValue(60);

		await service.onApplicationBootstrap();

		expect(mockUsersService.setupOwner).not.toHaveBeenCalled();
		expect(mockSeedDemoData).not.toHaveBeenCalled();
	});
});
