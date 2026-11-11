// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	NIGHTLY_NPM_ONLY,
	nightlyBlockedBy,
	readUpdateChannel,
	writeUpdateChannel,
} from "@prismalens/config";
import { describe, expect, it } from "vitest";
import {
	pinnedVersionValid,
	resolveUpdateChannel,
	upgradeArgv,
	upgradeEnv,
} from "./upgrade.js";

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

describe("upgradeEnv (#965)", () => {
	it("drops PSModulePath on Windows, in any case, and keeps the rest", () => {
		const env = { PSModulePath: "C:\pwsh7\Modules", Path: "C:\bin", psmodulepath: "x" };
		expect(upgradeEnv(env, "win32")).toEqual({ Path: "C:\bin" });
	});
	it("leaves the env alone elsewhere", () => {
		const env = { PSModulePath: "/opt/microsoft/powershell/Modules", PATH: "/bin" };
		expect(upgradeEnv(env, "linux")).toBe(env);
	});
});

describe("pinnedVersionValid", () => {
	it("accepts valid pinned versions and rejects invalid or unsupported on npm and installer", () => {
		expect(pinnedVersionValid("0.5.4-nightly.20261111.7", "npm")).toBe(true);
		expect(pinnedVersionValid("0.5.4", "npm")).toBe(true);
		expect(pinnedVersionValid("v0.5.4", "npm")).toBe(false);
		expect(pinnedVersionValid("0.5.4-nightly.01", "npm")).toBe(false);
		expect(pinnedVersionValid("0.5.4-nightly.20261111.7", "installer")).toBe(false);
		expect(pinnedVersionValid("0.5.4", "installer")).toBe(true);
	});
});

describe("resolveUpdateChannel", () => {
	const realConfig = {
		readUpdateChannel,
		writeUpdateChannel,
		nightlyBlockedBy,
	};

	it("requested nightly on npm sets nightly, saves to workspace file, and returns note", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			const res = resolveUpdateChannel(realConfig, workspace, "npm", "nightly", {});
			expect(res).toEqual({
				channel: "nightly",
				note: "Release channel set to nightly.",
			});
			expect(readUpdateChannel(workspace, {})).toBe("nightly");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("requested nightly on installer returns error NIGHTLY_NPM_ONLY and writes no file", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			const res = resolveUpdateChannel(realConfig, workspace, "installer", "nightly", {});
			expect(res).toEqual({ error: NIGHTLY_NPM_ONLY });
			expect(readUpdateChannel(workspace, {})).toBe("stable");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("requested beta returns error", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			const res = resolveUpdateChannel(realConfig, workspace, "npm", "beta", {});
			expect(res).toEqual({ error: '--channel takes stable or nightly, not "beta".' });
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("requested stable with env PRISMALENS_UPDATE_CHANNEL=nightly on npm returns channel nightly with override note", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			const env = { PRISMALENS_UPDATE_CHANNEL: "nightly" };
			const res = resolveUpdateChannel(realConfig, workspace, "npm", "stable", env);
			expect(res).toEqual({
				channel: "nightly",
				note: "Release channel saved as stable, but PRISMALENS_UPDATE_CHANNEL=nightly overrides it while it is set.",
			});
			// It was written as stable in the workspace file
			expect(readUpdateChannel(workspace, {})).toBe("stable");
			expect(readUpdateChannel(workspace, env)).toBe("nightly");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("no request, saved nightly, install homebrew falls back to stable with note", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			writeUpdateChannel(workspace, "nightly");
			const res = resolveUpdateChannel(realConfig, workspace, "homebrew", undefined, {});
			expect(res).toEqual({
				channel: "stable",
				note: `This copy was installed with homebrew, so it follows stable. ${NIGHTLY_NPM_ONLY}`,
			});
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("no request, nothing saved returns channel stable with no note key", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			const res = resolveUpdateChannel(realConfig, workspace, "npm", undefined, {});
			expect(res).toEqual({ channel: "stable" });
			expect("note" in res).toBe(false);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
