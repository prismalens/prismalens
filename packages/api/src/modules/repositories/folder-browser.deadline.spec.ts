// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({ opendir: vi.fn() }));
vi.mock("node:fs/promises", async (orig) => ({
	...(await orig<typeof import("node:fs/promises")>()),
	opendir: fsMock.opendir,
}));

const { browseFolders } = await import("./folder-browser.js");

const later = <T>(ms: number, value: T) =>
	new Promise<T>((r) => setTimeout(() => r(value), ms));
const folder = (name: string) => ({ name, isDirectory: () => true });

let root: string;
beforeEach(() => {
	root = realpathSync.native(mkdtempSync(join(tmpdir(), "pl-browse-deadline-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the folder listing's deadline (#1020)", () => {
	it("a folder that opens too slowly answers timeout, and its handle is closed once it opens", async () => {
		const close = vi.fn(async () => {});
		fsMock.opendir.mockReturnValueOnce(later(80, { read: vi.fn(), close }));
		expect(await browseFolders(root, { readMs: 20 })).toMatchObject({
			ok: false,
			error: "timeout",
		});
		await vi.waitFor(() => expect(close).toHaveBeenCalled(), { timeout: 1000 });
	});

	it("a read that stalls part way keeps what arrived, marked cut, and closes after the read ends", async () => {
		const read = vi
			.fn()
			.mockResolvedValueOnce(folder("api"))
			.mockReturnValueOnce(later(80, null));
		const close = vi.fn(async () => {
			throw new Error("already closed");
		});
		fsMock.opendir.mockResolvedValueOnce({ read, close });
		const got = await browseFolders(root, { readMs: 30 });
		expect(got).toMatchObject({ ok: true, truncated: true });
		expect(got.ok && got.entries.map((e) => e.name)).toEqual(["api"]);
		await vi.waitFor(() => expect(close).toHaveBeenCalled(), { timeout: 1000 });
	});

	it("an error that is not about access or absence is not hidden", async () => {
		fsMock.opendir.mockRejectedValueOnce(
			Object.assign(new Error("busy"), { code: "EBUSY" }),
		);
		await expect(browseFolders(root)).rejects.toThrow("busy");
	});

	it("stalled reads are capped: past the cap a listing answers busy, and frees up when they end", async () => {
		const ends: Array<() => void> = [];
		const stalled = () =>
			new Promise((r) => {
				ends.push(() => r({ read: async () => null, close: async () => {} }));
			});
		fsMock.opendir.mockImplementation(stalled);
		try {
			for (let i = 0; i < 2; i++)
				expect(await browseFolders(root, { readMs: 10, maxReads: 2 })).toMatchObject({
					error: "timeout",
				});
			expect(await browseFolders(root, { readMs: 10, maxReads: 2 })).toMatchObject({
				ok: false,
				error: "busy",
			});
			fsMock.opendir.mockImplementation(async () => ({
				read: async () => null,
				close: async () => {},
			}));
			for (const end of ends) end();
			await vi.waitFor(async () =>
				expect(
					(await browseFolders(root, { readMs: 200, maxReads: 2 })).ok,
				).toBe(true),
			);
		} finally {
			for (const end of ends) end();
			fsMock.opendir.mockReset();
		}
	});
});
