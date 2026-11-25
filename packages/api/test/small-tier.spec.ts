// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import childProcess from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as clock from "../src/core/clock.js";

const refusal = (what: string) =>
	`A small test (*.spec.ts) must not use ${what}. Mock it, or rename the file *.int.spec.ts.`;

describe("the small tier (#1154)", () => {
	it("starts every test on the fixed date, whatever today is", () => {
		expect(new Date().toISOString()).toBe("2026-11-24T12:00:00.000Z");
		expect(clock.date().toISOString()).toBe("2026-11-24T12:00:00.000Z");
		expect(clock.now()).toBe(Date.UTC(2026, 10, 24, 12));
	});

	it("never waits for real: a minute's sleep ends when the fake clock passes it", async () => {
		let woke = false;
		const sleeping = clock.sleep(60_000).then(() => {
			woke = true;
		});
		await vi.advanceTimersByTimeAsync(59_999);
		expect(woke).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await sleeping;
		expect(woke).toBe(true);
	});

	// Runs after the sleep above, which leaves its clock a minute on.
	it("puts the clock back on the fixed date after a test moved it", () => {
		expect(clock.date().toISOString()).toBe("2026-11-24T12:00:00.000Z");
	});

	it("gives a test 1000 ms", ({ task }) => {
		expect(task.timeout).toBe(1_000);
	});

	it.each([
		"spawn",
		"spawnSync",
		"exec",
		"execSync",
		"execFile",
		"execFileSync",
		"fork",
	] as const)("refuses a child process through %s", (form) => {
		const start = childProcess[form] as (file: string) => unknown;
		expect(() => start("git")).toThrow(
			new Error(refusal(`a child process (${form})`)),
		);
	});

	it("refuses a socket and a listening server", () => {
		expect(() => net.connect(80, "localhost")).toThrow(
			new Error(refusal("the network (connect)")),
		);
		expect(() => new net.Socket().connect(80, "127.0.0.1")).toThrow(
			new Error(refusal("the network (connect)")),
		);
		expect(() => net.createServer().listen(0)).toThrow(
			new Error(refusal("the network (listen)")),
		);
	});

	it("refuses a SQLite query but not the driver being loaded", () => {
		const fromDatabase = createRequire(
			join(
				realpathSync(
					fileURLToPath(
						new URL("../node_modules/@prismalens/database", import.meta.url),
					),
				),
				"package.json",
			),
		);
		const fromAdapter = createRequire(
			fromDatabase.resolve("@prisma/adapter-better-sqlite3"),
		);
		const Database = fromAdapter("better-sqlite3");
		const db = new Database(":memory:");
		expect(() => db.prepare("select 1")).toThrow(
			new Error(refusal("a SQLite database (prepare)")),
		);
	});
});
