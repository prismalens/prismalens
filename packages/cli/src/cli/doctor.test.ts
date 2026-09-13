// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { getAppDataDir, secretFileName } from "@prismalens/config";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	checkAnyHarnessOnPath,
	checkHarnessesOnPath,
	checkWebhookToken,
} from "./doctor.js";

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

describe("doctor — webhook token", () => {
	let tempDir: string;
	const originalWorkspace = process.env.PRISMALENS_WORKSPACE_DIR;

	beforeEach(() => {
		tempDir = join(
			os.tmpdir(),
			`pl-doctor-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempDir, { recursive: true });
		process.env.PRISMALENS_WORKSPACE_DIR = tempDir;
	});

	afterEach(() => {
		if (originalWorkspace === undefined) {
			delete process.env.PRISMALENS_WORKSPACE_DIR;
		} else {
			process.env.PRISMALENS_WORKSPACE_DIR = originalWorkspace;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reports webhook token file path and whether it exists without exposing the secret", () => {
		const expectedFile = join(
			tempDir,
			secretFileName("PRISMALENS_WEBHOOK_SECRET"),
		);

		// Before creation: does not exist, hard is false
		const checkBefore = checkWebhookToken();
		expect(checkBefore.name).toBe("Webhook token");
		expect(checkBefore.hard).toBe(false);
		expect(checkBefore.detail).toBe(`${expectedFile} (does not exist yet)`);

		// After creation: exists, hard is false, does NOT print the secret
		const secretValue = "super_secret_webhook_token_value_42";
		writeFileSync(expectedFile, secretValue);

		const checkAfter = checkWebhookToken();
		expect(checkAfter.name).toBe("Webhook token");
		expect(checkAfter.hard).toBe(false);
		expect(checkAfter.detail).toBe(`${expectedFile} (exists)`);
		expect(checkAfter.detail).not.toContain(secretValue);
	});
});
