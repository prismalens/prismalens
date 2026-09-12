// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAnyHarnessOnPath, checkHarnessesOnPath } from "./doctor.js";

describe("doctor — harness detection", () => {
	let tempPathDir: string;
	let originalPath: string | undefined;

	beforeEach(() => {
		tempPathDir = join(
			os.tmpdir(),
			`pl-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempPathDir, { recursive: true });
		originalPath = process.env.PATH;
	});

	afterEach(() => {
		rmSync(tempPathDir, { recursive: true, force: true });
		if (originalPath === undefined) {
			process.env.PATH = "";
		} else {
			process.env.PATH = originalPath;
		}
	});

	it("is a HARD failure, listing every registry harness, when none is on PATH", () => {
		process.env.PATH = tempPathDir; // empty dir — nothing resolvable

		const perHarness = checkHarnessesOnPath();
		expect(perHarness.every((check) => !check.pass)).toBe(true);

		const overall = checkAnyHarnessOnPath(perHarness);
		expect(overall.pass).toBe(false);
		expect(overall.hard).toBe(true);
		for (const id of Object.keys(HARNESS_REGISTRY)) {
			expect(overall.detail).toContain(id);
		}
	});

	it("passes when a registry harness binary is on PATH", () => {
		const descriptor = Object.values(HARNESS_REGISTRY)[0];
		const binPath = join(tempPathDir, descriptor.binary);
		writeFileSync(binPath, "#!/bin/sh\nexit 0\n");
		chmodSync(binPath, 0o755);
		process.env.PATH = tempPathDir;

		const perHarness = checkHarnessesOnPath();
		const match = perHarness.find((check) =>
			check.name.includes(descriptor.label),
		);
		expect(match?.pass).toBe(true);

		const overall = checkAnyHarnessOnPath(perHarness);
		expect(overall.pass).toBe(true);
		expect(overall.hard).toBe(true);
	});
});
