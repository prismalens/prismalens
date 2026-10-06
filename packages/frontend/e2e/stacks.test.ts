// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stackFor, workerCount } from "./stacks";

describe("stackFor", () => {
	it("refuses a workspace inside ~/.prismalens", () => {
		const root = join(homedir(), ".prismalens", "e2e-root");
		expect(() => stackFor(root, 0, 3000, 3001)).toThrow(/e2e refuses to run/);
	});

	it("refuses a workspace that IS ~/.prismalens itself", () => {
		const root = join(homedir(), ".prismalens");
		expect(() => stackFor(root, 0, 3000, 3001)).toThrow(/e2e refuses to run/);
	});

	it("allows a workspace outside ~/.prismalens, even one that shares its prefix", () => {
		const root = join(homedir(), ".prismalens-e2e-tmp");
		expect(() => stackFor(root, 0, 3000, 3001)).not.toThrow();
	});

	it("allocates one interleaved port pair per worker index, never colliding", () => {
		const root = "/tmp/prismalens-e2e-test-root";
		const stacks = Array.from({ length: 4 }, (_, i) =>
			stackFor(root, i, 3000, 3001),
		);
		expect(stacks.map((s) => s.frontendPort)).toEqual([
			"3000",
			"3002",
			"3004",
			"3006",
		]);
		expect(stacks.map((s) => s.apiPort)).toEqual([
			"3001",
			"3003",
			"3005",
			"3007",
		]);
		// No port is ever shared between a frontend and an API across workers.
		const allPorts = stacks.flatMap((s) => [s.frontendPort, s.apiPort]);
		expect(new Set(allPorts).size).toBe(allPorts.length);
	});

	it("gives each worker's stack its own workspace directory", () => {
		const root = "/tmp/prismalens-e2e-test-root";
		const stacks = Array.from({ length: 3 }, (_, i) =>
			stackFor(root, i, 3000, 3001),
		);
		expect(new Set(stacks.map((s) => s.workspaceDir)).size).toBe(3);
	});
});

describe("workerCount", () => {
	it("reads an explicit --workers=N off argv", () => {
		expect(workerCount(["--workers=2"], false)).toBe(2);
	});

	it("reads a -j N pair off argv", () => {
		expect(workerCount(["-j", "3"], false)).toBe(3);
	});

	it("reads a percentage and floors it against availableParallelism", () => {
		const n = workerCount(["--workers=50%"], false);
		expect(n).toBeGreaterThanOrEqual(1);
		expect(Number.isInteger(n)).toBe(true);
	});

	it("falls back to the CPU count in CI with no explicit value", () => {
		const n = workerCount([], true);
		expect(n).toBeGreaterThanOrEqual(1);
	});

	it("falls back to at most 4 outside CI with no explicit value", () => {
		const n = workerCount([], false);
		expect(n).toBeLessThanOrEqual(4);
		expect(n).toBeGreaterThanOrEqual(1);
	});

	it("ignores a non-numeric, non-percentage value and falls back", () => {
		const n = workerCount(["--workers=bogus"], false);
		expect(n).toBeGreaterThanOrEqual(1);
	});
});
