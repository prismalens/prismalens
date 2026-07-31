// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AuthService } from "./auth.service.js";

describe("AuthService", () => {
	it("initializes Better Auth with organization self-creation disabled and limit 1", async () => {
		const mockConfigService = {
			get: (key: string, defaultValue?: string) => {
				if (key === "PRISMALENS_AUTH_SECRET")
					return "test-secret-1234567890-test-secret-1234567890";
				if (key === "DATABASE_URL") return "file:./dev.db";
				if (key === "PRISMALENS_PUBLIC_URL") return "http://localhost:3001";
				return defaultValue ?? "";
			},
		};

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

		const orgPlugin = auth.options.plugins?.find(
			(plugin) => plugin.id === "organization",
		);

		expect(orgPlugin).toBeDefined();
		expect(orgPlugin?.options).toMatchObject({
			allowUserToCreateOrganization: false,
			organizationLimit: 1,
		});
	});
});
