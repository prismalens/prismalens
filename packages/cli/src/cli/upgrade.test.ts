// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { upgradeArgv } from "./upgrade.js";

describe("upgradeArgv", () => {
	it("runs each channel's own upgrade", () => {
		expect(upgradeArgv("npm", "0.5.1", "linux")).toEqual(["npm", "install", "-g", "prismalens@0.5.1"]);
		expect(upgradeArgv("installer", "0.5.1", "darwin")).toEqual([
			"sh",
			"-c",
			"curl -fsSL https://prismalens.io/install.sh | sh -s -- --version 0.5.1",
		]);
		expect(upgradeArgv("installer", "0.5.1", "win32")?.[0]).toBe("powershell");
		expect(upgradeArgv("homebrew", "0.5.1", "darwin")).toEqual(["brew", "upgrade", "prismalens"]);
		expect(upgradeArgv("scoop", "0.5.1", "win32")).toEqual(["cmd", "/c", "scoop", "update", "prismalens"]);
	});
	it("leaves the desktop app to its download", () => {
		expect(upgradeArgv("electron", "0.5.1", "darwin")).toBe(null);
	});
});
