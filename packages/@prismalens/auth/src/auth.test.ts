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
 * `closeSignUpAfterOwner` runs against a real Better Auth instance on the library's
 * in-memory adapter, so sign-up goes through its real validation and hooks; only the
 * plugin's Prisma lookup is faked, over the same in-memory user rows.
 */
function createTestAuth() {
	const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
	const fakePrisma = {
		user: { findFirst: async () => db.user[0] ?? null },
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

describe("close-sign-up-after-owner (one operator, ADR 0001 §13)", () => {
	it("setup's own sign-up succeeds while no account exists", async () => {
		const { auth } = createTestAuth();
		const result = await auth.api.signUpEmail({
			body: { email: "owner@example.com", password: "correct-horse-battery", name: "Owner" },
		});
		expect(result.user.email).toBe("owner@example.com");
	});

	it("any sign-up after the first account is 403 SIGN_UP_CLOSED", async () => {
		const { auth } = createTestAuth();
		await auth.api.signUpEmail({
			body: { email: "owner@example.com", password: "correct-horse-battery", name: "Owner" },
		});

		await expect(
			auth.api.signUpEmail({
				body: { email: "intruder@example.com", password: "correct-horse-battery", name: "Intruder" },
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "SIGN_UP_CLOSED" } });
	});
});
