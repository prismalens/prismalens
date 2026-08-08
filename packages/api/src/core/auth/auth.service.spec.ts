// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
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

	it("continues startup with a warning when the organization count is unreadable (fresh install, outage)", async () => {
		const mockPrismaService = {
			organization: {
				count: vi
					.fn()
					.mockRejectedValue(new Error("no such table: Organization")),
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
		// Boot aborts only on positive evidence of violation — never on an
		// unreadable count; creation stays fail-closed in the auth hook.
		await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
	});

	it("warns when NODE_ENV=production resolves to non-secure cookies (no PRISMALENS_PUBLIC_URL/PROTOCOL)", async () => {
		const mockPrismaService = {
			organization: {
				count: vi.fn().mockResolvedValue(1),
			},
		};
		const prodHttpConfigService = {
			get: (key: string, defaultValue?: string) => {
				if (key === "PRISMALENS_AUTH_SECRET")
					return "test-secret-1234567890-test-secret-1234567890";
				if (key === "DATABASE_URL") return "file:./dev.db";
				if (key === "NODE_ENV") return "production";
				// No PRISMALENS_PUBLIC_URL/PROTOCOL — publicUrl derives to http://...,
				// which is the gap: NODE_ENV=production but not actually behind TLS.
				return defaultValue ?? "";
			},
		};

		const warnSpy = vi
			.spyOn(Logger.prototype, "warn")
			.mockImplementation(() => undefined);

		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: ConfigService, useValue: prodHttpConfigService },
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		const service = moduleRef.get(AuthService);
		service.onModuleInit();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Secure attribute"),
		);

		warnSpy.mockRestore();
	});

	it("does not warn when the resolved origin is https", async () => {
		const mockPrismaService = {
			organization: {
				count: vi.fn().mockResolvedValue(1),
			},
		};
		const prodHttpsConfigService = {
			get: (key: string, defaultValue?: string) => {
				if (key === "PRISMALENS_AUTH_SECRET")
					return "test-secret-1234567890-test-secret-1234567890";
				if (key === "DATABASE_URL") return "file:./dev.db";
				if (key === "NODE_ENV") return "production";
				if (key === "PRISMALENS_PUBLIC_URL") return "https://example.com";
				return defaultValue ?? "";
			},
		};

		const warnSpy = vi
			.spyOn(Logger.prototype, "warn")
			.mockImplementation(() => undefined);

		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: ConfigService, useValue: prodHttpsConfigService },
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		const service = moduleRef.get(AuthService);
		service.onModuleInit();

		expect(warnSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("Secure attribute"),
		);

		warnSpy.mockRestore();
	});
});
