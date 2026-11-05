// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
	ends: [] as Array<() => void>,
	realpath: vi.fn(),
}));
vi.mock("node:fs/promises", async (orig) => {
	const real = await orig<typeof import("node:fs/promises")>();
	return { ...real, realpath: fsMock.realpath };
});

const {
	CANONICAL_MAX,
	CanonicalBusy,
	canonical,
	folderBusy,
	isCanonical,
	liveIn,
	pendingCanonical,
} = await import("./folder-lock.js");

/** A realpath on stalled storage: it never answers until the test lets it. */
function stall() {
	fsMock.realpath.mockImplementation(
		(p: string) =>
			new Promise((r) => {
				fsMock.ends.push(() => r(p));
			}),
	);
}

const at = (...p: string[]) => resolve("/", "code", ...p);

afterEach(async () => {
	for (const end of fsMock.ends.splice(0)) end();
	await vi.waitFor(() => expect(pendingCanonical()).toBe(0));
	fsMock.realpath.mockReset();
});

describe("canonical paths on stalled storage are capped (#1020, CP3 r3 OBJ-010)", () => {
	it("counts each realpath until it settles, and past the cap starts none", async () => {
		stall();
		for (let i = 0; i < CANONICAL_MAX; i++)
			expect(await canonical(at(`f${i}`), 5)).toBeNull();
		expect(pendingCanonical()).toBe(CANONICAL_MAX);
		await expect(canonical(at("one-more"), 5)).rejects.toBeInstanceOf(CanonicalBusy);
		expect(fsMock.realpath).toHaveBeenCalledTimes(CANONICAL_MAX);
		// Unknown is never "canonical": a run or Start git here refuses.
		expect(await isCanonical(at("again"), 5)).toBe(false);
	});

	it("the run lock fails closed when it cannot read the folders", async () => {
		stall();
		for (let i = 0; i < CANONICAL_MAX; i++) await canonical(at(`f${i}`), 5);
		const db = {
			repository: { findUnique: vi.fn(async () => ({ plain: true, url: at("notes") })) },
			investigation: { findMany: vi.fn(async () => []) },
		};
		expect(await folderBusy(db as never, "repo-1")).toBe(true);
	});

	it("bounds the fan-out over live runs: too many to check is busy, checked one at a time", async () => {
		fsMock.realpath.mockImplementation(async (p: string) => p);
		const many = Array.from({ length: 40 }, (_, i) => ({ repository: { url: at(`r${i}`) } }));
		const db = { investigation: { findMany: vi.fn(async () => many) } };
		expect(await liveIn(db as never, at("notes"))).toBe(true);
		const few = [{ repository: { url: at("other") } }];
		let peak = 0;
		fsMock.realpath.mockImplementation(async (p: string) => {
			peak = Math.max(peak, pendingCanonical());
			return p;
		});
		expect(await liveIn({ investigation: { findMany: vi.fn(async () => few) } } as never, at("notes"))).toBe(false);
		expect(peak).toBe(1);
	});
});
