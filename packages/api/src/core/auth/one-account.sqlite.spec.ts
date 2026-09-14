// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The one-account rule against a migrated SQLite file through the real Prisma adapter.
 * The in-memory adapter has no transactions, so only this proves the concurrent case.
 */
describe("one account only, concurrent sign-ups on SQLite", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-one-account-"));
	let prisma: typeof import("@prismalens/database").prisma;
	let createAuth: typeof import("@prismalens/auth").createAuth;

	beforeAll(async () => {
		process.env.PRISMALENS_WORKSPACE_DIR = dir;
		execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
			cwd: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../@prismalens/database"),
			env: { ...process.env, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes" },
			stdio: "pipe",
		});
		({ prisma } = await import("@prismalens/database"));
		({ createAuth } = await import("@prismalens/auth"));
	}, 120_000);

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates exactly one account when five sign-ups race", async () => {
		const auth = createAuth(prisma, {
			baseURL: "http://127.0.0.1:3001",
			secret: "one-account-secret-1234567890-one-account",
			secureCookies: false,
		});

		const results = await Promise.allSettled(
			Array.from({ length: 5 }, (_, i) =>
				auth.api.signUpEmail({
					body: { email: `u${i}@race.test`, password: "correct-horse-battery", name: `u${i}` },
				}),
			),
		);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(await prisma.user.count()).toBe(1);
	});
});
