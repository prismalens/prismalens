// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	clearReceipt,
	containPrevious,
	type OsProcess,
	type ProcessHost,
	readReceipt,
	snapshotReceipt,
	treeOf,
	writeReceipt,
} from "./harness-receipt.js";

const T = 1_700_000_000_000;

function winHost(table: OsProcess[], stubborn = new Set<number>()): ProcessHost & { killed: number[] } {
	const killed: number[] = [];
	return {
		platform: "win32",
		killed,
		list: () => table,
		groupAlive: () => false,
		kill: (pid) => {
			killed.push(pid);
			if (stubborn.has(pid)) return;
			const i = table.findIndex((p) => p.pid === pid);
			if (i >= 0) table.splice(i, 1);
		},
		sleep: async () => {},
	};
}

describe("harness receipt (#981 OBJ-010)", () => {
	it("round-trips through the run dir and clears", () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-receipt-"));
		try {
			expect(readReceipt(dir)).toBeNull();
			writeReceipt(dir, 4120, T);
			expect(readReceipt(dir)).toEqual({ pid: 4120, startedAt: T });
			clearReceipt(dir);
			expect(readReceipt(dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("walks the tree from the root by parent pid, orphans included, and skips a reused pid", () => {
		const all: OsProcess[] = [
			{ pid: 4120, parent: 1, created: T + 50 },
			{ pid: 5000, parent: 4120, created: T + 1_000 },
			{ pid: 6000, parent: 5000, created: T + 2_000 },
			// The root died; its child keeps the parent pid.
			{ pid: 7000, parent: 4120, created: T + 3_000 },
			// Created before the root started: an older process that was handed a reused parent pid.
			{ pid: 8000, parent: 4120, created: T - 60_000 },
		];
		expect(treeOf({ pid: 4120, startedAt: T }, all).map((p) => p.pid).sort()).toEqual([4120, 5000, 6000, 7000]);
		// The pid now belongs to an unrelated process started long after.
		expect(treeOf({ pid: 4120, startedAt: T - 3_600_000 }, [{ pid: 4120, parent: 1, created: T }])).toEqual([]);
	});

	it("no receipt, or nothing left of the tree, is contained", async () => {
		expect(await containPrevious(null, winHost([]))).toBe(true);
		const host = winHost([{ pid: 99, parent: 1, created: T }]);
		expect(await containPrevious({ pid: 4120, startedAt: T }, host)).toBe(true);
		expect(host.killed).toEqual([]);
	});

	it("kills a surviving tree, then reports it contained", async () => {
		const host = winHost([
			{ pid: 4120, parent: 1, created: T },
			{ pid: 5000, parent: 4120, created: T + 10 },
		]);
		expect(await containPrevious({ pid: 4120, startedAt: T }, host)).toBe(true);
		expect(host.killed.sort()).toEqual([4120, 5000]);
	});

	it("a process that will not die is not contained, so the run is not resumed", async () => {
		const host = winHost([{ pid: 4120, parent: 1, created: T }], new Set([4120]));
		expect(await containPrevious({ pid: 4120, startedAt: T }, host)).toBe(false);
	});

	it("POSIX checks and kills the whole process group", async () => {
		let alive = true;
		const kills: [number, boolean][] = [];
		const host: ProcessHost = {
			platform: "linux",
			list: () => [],
			groupAlive: () => alive,
			kill: (pid, group) => {
				kills.push([pid, group]);
				alive = false;
			},
			sleep: async () => {},
		};
		expect(await containPrevious({ pid: 4120, startedAt: T }, host)).toBe(true);
		expect(kills).toEqual([[4120, true]]);
	});
	it("finds a tool whose parent exited, from the tree the last snapshot recorded", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-receipt-"));
		try {
			writeReceipt(dir, 4120, T);
			// While running: harness 4120 -> shell 5000 -> tool 6000.
			await snapshotReceipt(dir, async () => [
				{ pid: 4120, parent: 1, created: T + 50 },
				{ pid: 5000, parent: 4120, created: T + 1_000 },
				{ pid: 6000, parent: 5000, created: T + 2_000 },
			]);
			expect(readReceipt(dir)?.tree).toEqual([
				{ pid: 5000, created: T + 1_000 },
				{ pid: 6000, created: T + 2_000 },
			]);
			// After the crash the harness and the shell are gone; the tool survives.
			const left = treeOf(readReceipt(dir) as never, [
				{ pid: 6000, parent: 5000, created: T + 2_000 },
				{ pid: 6100, parent: 6000, created: T + 9_000 },
			]);
			expect(left.map((p) => p.pid).sort()).toEqual([6000, 6100]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("a receipt written late, after PrismaLens was paused, still knows its root and kills it (OBJ-010)", async () => {
		// The agent was born at T; PrismaLens wrote the receipt 20 s later.
		const table: OsProcess[] = [{ pid: 4120, parent: 1, created: T }];
		const host = winHost(table);
		expect(await containPrevious({ pid: 4120, startedAt: T + 20_000 }, host)).toBe(true);
		expect(host.killed).toEqual([4120]);
	});

	it("a root pid now held by a younger process claims only the children born before it", () => {
		const all: OsProcess[] = [
			{ pid: 4120, parent: 1, created: T + 600_000 },
			{ pid: 7000, parent: 4120, created: T + 3_000 },
			{ pid: 9000, parent: 4120, created: T + 700_000 },
		];
		expect(treeOf({ pid: 4120, startedAt: T }, all).map((p) => p.pid)).toEqual([7000]);
	});
	it("a snapshot that finishes after the next turn wrote its receipt leaves that receipt alone (OBJ-021)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-receipt-"));
		try {
			writeReceipt(dir, 100, T);
			await snapshotReceipt(dir, async () => {
				clearReceipt(dir);
				writeReceipt(dir, 900, T + 60_000);
				return [{ pid: 100, parent: 1, created: T }];
			});
			expect(readReceipt(dir)).toEqual({ pid: 900, startedAt: T + 60_000 });
			writeReceipt(dir, 900, T + 60_000);
			await snapshotReceipt(dir, async () => [], () => false);
			expect(readReceipt(dir)?.tree).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
