// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heldOn } from "./scripts/ui-measure.mjs";

// The matrix's counts move with the OS's fonts and scrollbars, so the ceilings hold only where they were measured (#1238).
describe("the ui budget's platform", () => {
	it("names the OS its ceilings were measured on", () => {
		const budget = JSON.parse(readFileSync("ui-budget.json", "utf8")) as { platform?: string };
		expect(budget.platform).toBe("win32");
	});

	it("holds a run on that OS, and not a run on another", () => {
		expect(heldOn({ platform: "win32" }, "win32")).toBe(true);
		expect(heldOn({ platform: "win32" }, "linux")).toBe(false);
	});
});
