// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { APIError } from "better-auth";
import { describe, expect, it } from "vitest";
import { assertOrganizationCreatable, createAuth } from "./auth.js";

describe("createAuth single-tenant organization enforcement", () => {
	const mockPrisma = {} as unknown;

	const options = {
		databaseProvider: "sqlite" as const,
		baseURL: "http://localhost:3000",
		secret: "test-secret-1234567890-test-secret-1234567890",
		secureCookies: false,
	};

	it("disables organization self-creation and sets organization limit to 1", () => {
		const auth = createAuth(mockPrisma, options);
		const orgPlugin = auth.options.plugins?.find(
			(plugin) => plugin.id === "organization",
		);

		expect(orgPlugin).toBeDefined();
		expect(orgPlugin?.options).toMatchObject({
			allowUserToCreateOrganization: false,
			organizationLimit: 1,
		});
	});

	it("exposes organization plugin endpoints for provisioned org workflows", () => {
		const auth = createAuth(mockPrisma, options);

		// Organization plugin endpoints remain available for provisioned organization operations (roles, invitations, members)
		expect(auth.api.listOrganizations).toBeDefined();
		expect(auth.api.createInvitation).toBeDefined();
		expect(auth.api.acceptInvitation).toBeDefined();
		expect(auth.api.addMember).toBeDefined();
	});

	it("rejects unauthorized self-creation requests for secondary organizations", async () => {
		const auth = createAuth(mockPrisma, options);

		const res = await auth.api.createOrganization({
			body: {
				name: "Second Org",
				slug: "second-org",
			},
			asResponse: true,
		});

		// Organization creation is rejected
		expect(res.status).not.toBe(200);
	});

	it("hook guard allows creation only when no organization exists", async () => {
		await expect(
			assertOrganizationCreatable({ organization: { count: async () => 0 } }),
		).resolves.toBeUndefined();
	});

	it("hook guard fails closed: existing org, unreadable count, throwing query, missing model", async () => {
		const failClosedCases: unknown[] = [
			{ organization: { count: async () => 1 } },
			{ organization: { count: async () => "bogus" } },
			{
				organization: {
					count: async () => {
						throw new Error("db down");
					},
				},
			},
			{},
		];
		for (const prismaCase of failClosedCases) {
			await expect(
				assertOrganizationCreatable(prismaCase),
			).rejects.toBeInstanceOf(APIError);
		}
	});
});
