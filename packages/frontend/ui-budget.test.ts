// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The matrix's counts move with the OS's fonts and scrollbars, so the ceilings hold only where they were measured (#1238).
const budget = JSON.parse(readFileSync("ui-budget.json", "utf8")) as {
	platform?: string;
};
const dir = mkdtempSync(join(tmpdir(), "ui-budget-"));
const over = { contrast: [], smallTargets: [], clipped: [], axeOther: [], consoleErrors: [], controls: 999 };
writeFileSync(join(dir, "matrix.json"), JSON.stringify({ report: { "empty-home-1280-dark": over } }));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The checker on an over-budget run, as if on `platform`. */
const check = (platform: string) =>
	spawnSync(
		process.execPath,
		[
			"--import",
			`data:text/javascript,Object.defineProperty(process,"platform",{value:"${platform}"})`,
			"scripts/check-ui-budget.mjs",
			dir,
		],
		{ encoding: "utf8" },
	);

describe("the ui budget's platform", () => {
	it("names the OS its ceilings were measured on", () => {
		expect(budget.platform).toBe("win32");
	});

	it("fails an over-budget run on that OS", () => {
		const run = check("win32");
		expect(run.status).toBe(1);
		expect(run.stdout).toContain("empty-home-1280-dark controls:");
	});

	it("does not hold a run on another OS to it", () => {
		const run = check("linux");
		expect(run.status).toBe(0);
		expect(run.stdout).toContain("measured on win32; a linux run is not held to it");
	});
});
