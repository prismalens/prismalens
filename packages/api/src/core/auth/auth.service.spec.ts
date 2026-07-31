// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";

describe("AuthService", () => {
	const mockConfigService = {
		get: (key: string, defaultValue?: string) => {
			if (key === "PRISMALENS_AUTH_SECRET")
				return "test-secret-1234567890-test-secret-1234567890";
			if (key === "DATABASE_URL") return "file:./dev.db";
			if (key === "PRISMALENS_PUBLIC_URL") return "http://localhost:3001";
			return defaultValue ?? "";
		},
	};

	it("initializes Better Auth with organization self-creation disabled and limit 1", async () => {
		const mockPrismaService = {
			organization: {
				count: vi.fn().mockResolvedValue(1),
			},
		};

		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: ConfigService, useValue: mockConfigService },
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		const service = moduleRef.get(AuthService);
		service.onModuleInit();

		const auth = service.auth;
		expect(auth).toBeDefined();

		const orgPlugin = auth.options.plugins?.find(
			(plugin) => plugin.id === "organization",
		);

		expect(orgPlugin).toBeDefined();
		expect(orgPlugin?.options).toMatchObject({
			allowUserToCreateOrganization: false,
			organizationLimit: 1,
		});
	});

	it("throws an ADR-0011 §6 startup error when organization count > 1", async () => {
		const mockPrismaService = {
			organization: {
				count: vi.fn().mockResolvedValue(2),
			},
		};

		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: ConfigService, useValue: mockConfigService },
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		const service = moduleRef.get(AuthService);
		await expect(service.onApplicationBootstrap()).rejects.toThrow(
			/ADR-0011 §6 single-tenant core invariant violation/,
		);
	});

	it("completes startup normally when organization count <= 1", async () => {
		const mockPrismaService = {
			organization: {
				count: vi.fn().mockResolvedValue(1),
			},
		};

		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: ConfigService, useValue: mockConfigService },
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		const service = moduleRef.get(AuthService);
		await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
	});
});
