// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => vi.fn());
vi.mock("playwright-core", () => ({
	chromium: {
		executablePath: () => "",
		launchPersistentContext: launch,
	},
}));

const { LAUNCH_TIMEOUT_MS, launchEngine } = await import("./browser-engine.js");

const dirs: string[] = [];
afterEach(() => {
	launch.mockReset();
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const profile = () => {
	const d = mkdtempSync(join(tmpdir(), "pl-engine-"));
	dirs.push(d);
	return join(d, "profile");
};

describe("launchEngine (#1061)", () => {
	it("gives every browser it tries 60 s to start, so a cold start on a loaded host is not read as no engine (#1154)", async () => {
		launch.mockRejectedValue(new Error("not here"));
		expect(await launchEngine(profile())).toBeNull();
		expect(launch.mock.calls.map(([, o]) => [o.channel, o.timeout])).toEqual([
			["chrome", 60_000],
			["msedge", 60_000],
		]);
		expect(LAUNCH_TIMEOUT_MS).toBe(60_000);
	});

	it("answers the first browser that starts, by its name", async () => {
		const context = { id: "ctx" };
		launch.mockResolvedValueOnce(context);
		expect(await launchEngine(profile())).toEqual({
			context,
			name: "Google Chrome",
		});
		expect(launch).toHaveBeenCalledTimes(1);
	});
});
