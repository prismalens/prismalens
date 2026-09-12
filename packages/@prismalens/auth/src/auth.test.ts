// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { createAuth } from "./auth.js";

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
		// Single-tenant: no organization/admin plugin — `plugins` isn't even a key
		// on the options this build produces (asserted at compile time by
		// createAuth's own return type, not re-checked at runtime here).
		expect("plugins" in auth.options).toBe(false);
	});
});
