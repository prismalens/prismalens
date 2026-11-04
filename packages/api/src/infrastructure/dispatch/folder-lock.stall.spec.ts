// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ realpath: () => new Promise(() => {}) }));

const { FOLDER_TX, folderBusy, holdConversion } = await import("./folder-lock.js");

afterEach(() => vi.useRealTimers());

describe("the folder checks inside a transaction stay within its budget (#1020)", () => {
	it("a stalled drive costs two lookup rounds, not one per folder, and fits FOLDER_TX", async () => {
		vi.useFakeTimers();
		const release = holdConversion("/code/held");
		const db = {
			repository: { findUnique: async () => ({ plain: true, url: "/code/notes" }) },
			investigation: {
				findMany: async () =>
					["a", "b", "c", "d"].map((n) => ({ repository: { url: `/code/${n}` } })),
			},
		};
		let done = false;
		const run = folderBusy(db as never, "repo-1", "self").then((v) => {
			done = true;
			return v;
		});
		// Round one (the folder and held conversions) and round two (the live runs) are 3 s each.
		await vi.advanceTimersByTimeAsync(6000);
		expect(done).toBe(true);
		expect(await run).toBe(false);
		expect(FOLDER_TX.timeout).toBeGreaterThan(6000);
		release();
	});
});
