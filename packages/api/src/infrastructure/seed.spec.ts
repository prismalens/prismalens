// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `packages/api/scripts/seed.ts`, the standalone `prisma db seed` entry. There
 * is no account to bootstrap (ADR 0001 §2); what is left to prove is that demo
 * data lands in an empty database and nowhere else. Runs against a fake
 * Prisma delegate, no database.
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

function fakeDb() {
	return {
		alert: { count: vi.fn(async () => 0) },
		incident: { count: vi.fn(async () => 0) },
		// biome-ignore lint/suspicious/noExplicitAny: structural test double.
	} as any;
}

describe("seed — demo data", () => {
	beforeEach(() => {
		mocks.seedDemoData.mockClear();
	});

	it("seeds demo data when the database has neither alerts nor incidents", async () => {
		const db = fakeDb();
		await seed(db);
		expect(mocks.seedDemoData).toHaveBeenCalledWith(db);
	});

	it("does not seed demo data when the database already has alerts", async () => {
		const db = fakeDb();
		db.alert.count.mockResolvedValue(1);
		await seed(db);
		expect(mocks.seedDemoData).not.toHaveBeenCalled();
	});

	it("does not seed demo data when the database already has incidents", async () => {
		const db = fakeDb();
		db.incident.count.mockResolvedValue(3);
		await seed(db);
		expect(mocks.seedDemoData).not.toHaveBeenCalled();
	});
});
