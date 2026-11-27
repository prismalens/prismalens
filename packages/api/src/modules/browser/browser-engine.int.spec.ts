// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LaunchFailure, launchEngine } from "./browser-engine.js";

describe("launchEngine failures (#1238)", () => {
	it("Given every launch runs out of time, When none starts, Then each try's reason is kept and an installed one reads as timed out, not missing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-engine-"));
		const failures: LaunchFailure[] = [];
		const engine = await launchEngine(dir, failures, 1);
		await engine?.context.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		expect(engine?.name ?? null).toBeNull();
		expect(failures.map((f) => f.name)).toEqual(expect.arrayContaining(["Google Chrome", "Microsoft Edge"]));
		expect(failures.filter((f) => f.message === "")).toEqual([]);
		expect(failures.map((f) => f.timedOut)).toEqual(failures.map((f) => /Timeout 1ms exceeded/.test(f.message)));
	}, 30_000);
});
