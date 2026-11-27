// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type LaunchFailure, launchEngine, launchFailure } from "./browser-engine.js";

// Slowest test ~2 s here; a real start allows 45 s for each of up to three tries (#1154, #1238).
vi.setConfig({ testTimeout: 150_000 });

async function launch(timeout: number) {
	const dir = mkdtempSync(join(tmpdir(), "pl-engine-"));
	const failures: LaunchFailure[] = [];
	const engine = await launchEngine(dir, failures, timeout);
	await engine?.context.close();
	rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	return { name: engine?.name ?? null, failures };
}

describe("launchEngine failures (#1238)", () => {
	it("Given an installed browser, When its launch runs out of time, Then its try is kept as timed out, not missing", async () => {
		const available = await launch(45_000);
		if (!available.name)
			throw new Error(
				`no browser engine on this machine: ${available.failures.map((f) => `${f.name}: ${f.message}`).join("; ")}`,
			);
		const slow = await launch(1);
		expect(slow.name).toBeNull();
		expect(slow.failures.find((f) => f.name === available.name)).toMatchObject({
			name: available.name,
			timedOut: true,
			message: expect.stringContaining("Timeout 1ms exceeded"),
		});
	});

	it("Given a browser that is not installed, When its launch fails, Then the try reads as missing, not timed out", () => {
		const missing = launchFailure(
			"Google Chrome",
			new Error(
				"browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome\nRun \"npx playwright install chrome\"",
			),
		);
		expect(missing).toEqual({
			name: "Google Chrome",
			message:
				"browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome",
			timedOut: false,
		});
	});
});
