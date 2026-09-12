// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The owner-bootstrap branch of `packages/api/scripts/seed.ts` — the standalone
 * `prisma db seed` entry that replaced `DevSeedModule` (#601). Runs against a
 * fake Prisma delegate + a fake Better Auth instance, no database.
 *
 * `seedDemoData` is mocked at the module boundary: it is a real
 * `@prismalens/database` export that expects a full Prisma client, out of
 * scope for this fake-delegate test — only whether it gets CALLED matters here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ seedDemoData: vi.fn(async () => {}) }));

vi.mock("@prismalens/database", () => ({
	prisma: {},
	seedDemoData: mocks.seedDemoData,
}));

const { seed } = await import("../../scripts/seed.js");

function fakeDb(overrides: { existingOwner?: unknown } = {}) {
	return {
		user: {
			findFirst: vi.fn(async () => overrides.existingOwner ?? null),
			update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
				id: "user-1",
				...args.data,
			})),
		},
		session: {
			deleteMany: vi.fn(async () => ({ count: 1 })),
		},
		alert: { count: vi.fn(async () => 0) },
		incident: { count: vi.fn(async () => 0) },
		// biome-ignore lint/suspicious/noExplicitAny: structural test double.
	} as any;
}

function fakeAuth(user: { id: string; token?: string } | null = { id: "user-1", token: "tok-1" }) {
	return {
		api: {
			signUpEmail: vi.fn(async () =>
				user ? { user: { id: user.id }, token: user.token } : null,
			),
		},
		// biome-ignore lint/suspicious/noExplicitAny: structural test double.
	} as any;
}

describe("seed — owner bootstrap", () => {
	beforeEach(() => {
		mocks.seedDemoData.mockClear();
	});

	it("creates the owner via signUpEmail, promotes the role, and drops the stale session", async () => {
		const db = fakeDb();
		const auth = fakeAuth();

		await seed(db, auth);

		expect(auth.api.signUpEmail).toHaveBeenCalledWith({
			body: {
				email: "admin@prismalens.dev",
				password: "admin123",
				name: "Admin",
			},
		});
		expect(db.user.update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { role: "owner" },
		});
		expect(db.session.deleteMany).toHaveBeenCalledWith({
			where: { token: "tok-1" },
		});
	});

	it("skips owner creation when an owner/admin already exists", async () => {
		const db = fakeDb({ existingOwner: { id: "existing", role: "owner" } });
		const auth = fakeAuth();

		await seed(db, auth);

		expect(auth.api.signUpEmail).not.toHaveBeenCalled();
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it("throws when signUpEmail returns no user", async () => {
		const db = fakeDb();
		const auth = fakeAuth(null);

		await expect(seed(db, auth)).rejects.toThrow(/failed to create the owner/);
	});

	it("seeds demo data when the database has neither alerts nor incidents", async () => {
		const db = fakeDb({ existingOwner: { id: "existing" } });
		const auth = fakeAuth();

		await seed(db, auth);

		expect(mocks.seedDemoData).toHaveBeenCalledWith(db);
	});

	it("does not seed demo data when the database already has alerts", async () => {
		const db = fakeDb({ existingOwner: { id: "existing" } });
		db.alert.count.mockResolvedValue(1);
		const auth = fakeAuth();

		await seed(db, auth);

		expect(mocks.seedDemoData).not.toHaveBeenCalled();
	});
});
