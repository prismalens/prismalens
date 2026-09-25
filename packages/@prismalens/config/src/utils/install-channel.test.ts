// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { installChannel, upgradeCommand } from "./install-channel.js";

describe("installChannel", () => {
	it("tells the channels apart by launcher and by where node lives", () => {
		expect(installChannel({}, "/usr/local/bin/node")).toBe("npm");
		expect(installChannel({ PRISMALENS_RUN_MODE: "electron" }, "/x")).toBe("electron");
		expect(installChannel({ PRISMALENS_INSTALL: "standalone" }, "/x/node")).toBe("installer");
		expect(
			installChannel(
				{ PRISMALENS_INSTALL: "standalone" },
				"/opt/homebrew/Cellar/prismalens/0.5.1/libexec/node/bin/node",
			),
		).toBe("homebrew");
		expect(
			installChannel(
				{ PRISMALENS_INSTALL: "standalone" },
				"C:\\Users\\me\\scoop\\apps\\prismalens\\0.5.1\\node\\node.exe",
			),
		).toBe("scoop");
		expect(installChannel({}, "/opt/homebrew/Cellar/node/24.1.0/bin/node")).toBe("npm");
	});
});

describe("upgradeCommand", () => {
	it("names each channel's own command, pinned when asked", () => {
		expect(upgradeCommand("npm")).toBe("npm install -g prismalens@latest");
		expect(upgradeCommand("npm", "linux", "0.5.1")).toBe("npm install -g prismalens@0.5.1");
		expect(upgradeCommand("installer", "darwin", "0.5.1")).toBe(
			"curl -fsSL https://prismalens.io/install.sh | sh -s -- --version 0.5.1",
		);
		expect(upgradeCommand("installer", "win32")).toContain("install.ps1");
		expect(upgradeCommand("homebrew")).toBe("brew upgrade prismalens");
		expect(upgradeCommand("scoop")).toBe("scoop update prismalens");
		expect(upgradeCommand("electron", "darwin", "0.5.1")).toContain("releases/tag/v0.5.1");
	});
});
