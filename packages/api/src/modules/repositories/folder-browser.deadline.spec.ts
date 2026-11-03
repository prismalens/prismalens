// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
	opendir: vi.fn(),
	lstat: vi.fn(),
	realpath: vi.fn(),
	slowSync: { ms: 0 },
}));
vi.mock("node:fs/promises", async (orig) => {
	const real = await orig<typeof import("node:fs/promises")>();
	fsMock.lstat.mockImplementation(real.lstat);
	fsMock.realpath.mockImplementation(real.realpath);
	return {
		...real,
		opendir: fsMock.opendir,
		lstat: fsMock.lstat,
		realpath: fsMock.realpath,
	};
});
// A blocking realpath, as a slow disk makes it: the busy wait stands in for the stall.
vi.mock("node:fs", async (orig) => {
	const real = await orig<typeof import("node:fs")>();
	const native = (p: string) => {
		const until = Date.now() + fsMock.slowSync.ms;
		while (Date.now() < until) {}
		return real.realpathSync.native(p);
	};
	return {
		...real,
		realpathSync: Object.assign(
			(p: string) => real.realpathSync(p),
			{ native },
		),
	};
});

const { browseFolders, outstandingReads } = await import("./folder-browser.js");

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

	it("after a partial read times out, no more stats start, and the stalled read is still counted", async () => {
		let endRead = () => {};
		const read = vi
			.fn()
			.mockResolvedValueOnce(folder("api"))
			.mockReturnValueOnce(new Promise((r) => (endRead = () => r(null))));
		fsMock.opendir.mockResolvedValueOnce({ read, close: async () => {} });
		await vi.waitFor(() => expect(outstandingReads()).toBe(0));
		fsMock.lstat.mockClear();
		const got = await browseFolders(root, { readMs: 30, maxReads: 5 });
		expect(got).toMatchObject({ ok: true, truncated: true });
		// Only the folder's own lstat ran: none for the entry's .git or the parents.
		expect(fsMock.lstat).toHaveBeenCalledTimes(1);
		expect(outstandingReads()).toBe(1);
		endRead();
		await vi.waitFor(() => expect(outstandingReads()).toBe(0));
	});

	it("a close that stalls is counted against the cap until it ends", async () => {
		let endClose = () => {};
		const close = vi.fn(() => new Promise<void>((r) => (endClose = r)));
		fsMock.opendir.mockResolvedValueOnce({ read: async () => null, close });
		await vi.waitFor(() => expect(outstandingReads()).toBe(0));
		expect((await browseFolders(root, { readMs: 200, maxReads: 1 })).ok).toBe(true);
		await vi.waitFor(() => expect(close).toHaveBeenCalled());
		expect(outstandingReads()).toBe(1);
		expect(await browseFolders(root, { readMs: 200, maxReads: 1 })).toMatchObject({
			error: "busy",
		});
		endClose();
		await vi.waitFor(() => expect(outstandingReads()).toBe(0));
	});

	it("a slow check for links never stops the server answering others", async () => {
		fsMock.opendir.mockResolvedValueOnce({ read: async () => null, close: async () => {} });
		fsMock.slowSync.ms = 200;
		fsMock.realpath.mockImplementationOnce(
			(p: string) => new Promise((r) => setTimeout(() => r(p), 200)),
		);
		let ticks = 0;
		const tick = setInterval(() => ticks++, 10);
		try {
			await browseFolders(root, { readMs: 2000, maxReads: 5 });
		} finally {
			clearInterval(tick);
			fsMock.slowSync.ms = 0;
		}
		expect(ticks).toBeGreaterThanOrEqual(5);
	});
});
