// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inProcessTarget } from "./in-process-target.js";

const attempted = vi.hoisted(() => ({ journeysDir: "" }));

// Only the journeys directory fails, so the app boots and then setup breaks.
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return {
		...fs,
		mkdirSync: ((...args: Parameters<typeof fs.mkdirSync>) => {
			const [path] = args;
			if (String(path).endsWith("journeys")) {
				attempted.journeysDir = String(path);
				throw new Error("disk full");
			}
			return fs.mkdirSync(...args);
		}) as typeof fs.mkdirSync,
	};
});

describe("The in-process target", () => {
	it("Given setup fails after the app is listening, When the target is opened, Then the error surfaces, the app is stopped and its workspace removed", async () => {
		await expect(inProcessTarget()).rejects.toThrow("disk full");

		expect(existsSync(dirname(attempted.journeysDir))).toBe(false);
	}, 60_000);
});
