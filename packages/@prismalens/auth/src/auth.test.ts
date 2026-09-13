// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { closeSignUpAfterOwner, createAuth } from "./auth.js";

describe("createAuth", () => {
	const mockPrisma = {} as unknown;

	const options = {
		baseURL: "http://localhost:3000",
		secret: "test-secret-1234567890-test-secret-1234567890",
		secureCookies: false,
	};

	it("builds a Better Auth instance with email/password enabled", () => {
		const auth = createAuth(mockPrisma, options);

		expect(auth).toBeDefined();
		expect(auth.options.emailAndPassword?.enabled).toBe(true);
		// Single-tenant: no organization/admin plugin. The only plugin present is
		// this repo's own sign-up gate (below), never a multi-tenant Better Auth
		// plugin.
		expect(auth.options.plugins?.map((p) => p.id)).toEqual([
			"close-sign-up-after-owner",
		]);
	});
});

/**
 * `role` is a prismalens column, not a Better Auth field (no
 * `user.additionalFields` declares it), so `closeSignUpAfterOwner` queries
 * Prisma directly rather than through `ctx.context.adapter` (see auth.ts).
 * These tests exercise that plugin against a real Better Auth instance built
 * with the library's own in-memory adapter, so sign-up runs its real
 * validation and hook pipeline; only the `role` lookup is faked, over the
 * same in-memory array Better Auth's adapter writes `user` rows to.
 */
function createTestAuth() {
	const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
	const fakePrisma = {
		user: {
			findFirst: async ({ where }: { where: { role: { in: readonly string[] } } }) =>
				db.user.find((u) => where.role.in.includes(u.role as string)) ?? null,
		},
	};
	const auth = betterAuth({
		database: memoryAdapter(db),
		baseURL: "http://localhost:3000",
		secret: "test-secret-1234567890-test-secret-1234567890",
		emailAndPassword: { enabled: true, requireEmailVerification: false },
		plugins: [closeSignUpAfterOwner(fakePrisma)],
	});
	return { auth, db };
}

describe("close-sign-up-after-owner (trust floor, #628)", () => {
	it("setup itself still works: the first sign-up succeeds with no owner yet", async () => {
		const { auth } = createTestAuth();
		const result = await auth.api.signUpEmail({
			body: {
				email: "owner@example.com",
				password: "correct-horse-battery",
				name: "Owner",
			},
		});
		expect(result.user.email).toBe("owner@example.com");
	});

	it("a second sign-up before any owner is promoted is still allowed", async () => {
		const { auth } = createTestAuth();
		await auth.api.signUpEmail({
			body: {
				email: "first@example.com",
				password: "correct-horse-battery",
				name: "First",
			},
		});
		const second = await auth.api.signUpEmail({
			body: {
				email: "second@example.com",
				password: "correct-horse-battery",
				name: "Second",
			},
		});
		expect(second.user.email).toBe("second@example.com");
	});

	it("sign-up after setup is 403 once an owner row exists", async () => {
		const { auth, db } = createTestAuth();
		const { user } = await auth.api.signUpEmail({
			body: {
				email: "owner@example.com",
				password: "correct-horse-battery",
				name: "Owner",
			},
		});
		// Stand-in for `UsersService.setupOwner`'s role write, which happens
		// after Better Auth's own signup — this test isolates the sign-up gate,
		// not the setup flow's role promotion.
		const row = db.user.find((u) => u.id === user.id);
		if (row) row.role = "owner";

		await expect(
			auth.api.signUpEmail({
				body: {
					email: "intruder@example.com",
					password: "correct-horse-battery",
					name: "Intruder",
				},
			}),
		).rejects.toMatchObject({
			status: "FORBIDDEN",
			body: { code: "SIGN_UP_CLOSED" },
		});
	});
});
