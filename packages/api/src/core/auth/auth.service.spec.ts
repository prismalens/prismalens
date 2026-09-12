// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";

describe("AuthService", () => {
	const mockConfigService = {
		get: (key: string, defaultValue?: string) => {
			if (key === "PRISMALENS_AUTH_SECRET")
				return "test-secret-1234567890-test-secret-1234567890";
			if (key === "PRISMALENS_PUBLIC_URL") return "http://localhost:3001";
			return defaultValue ?? "";
		},
	};

	it("initializes Better Auth", async () => {
		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: ConfigService, useValue: mockConfigService },
			],
		}).compile();

		const service = moduleRef.get(AuthService);
		service.onModuleInit();

		const auth = service.auth;
		expect(auth).toBeDefined();
	});

	it("warns when NODE_ENV=production resolves to non-secure cookies (no PRISMALENS_PUBLIC_URL/PROTOCOL)", async () => {
		const prodHttpConfigService = {
			get: (key: string, defaultValue?: string) => {
				if (key === "PRISMALENS_AUTH_SECRET")
					return "test-secret-1234567890-test-secret-1234567890";
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
		const prodHttpsConfigService = {
			get: (key: string, defaultValue?: string) => {
				if (key === "PRISMALENS_AUTH_SECRET")
					return "test-secret-1234567890-test-secret-1234567890";
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
