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
	commandVersion,
	pinnedVersionValid,
	launcherInfo,
	launcherSteps,
	rollbackSteps,
	runSteps,
	STEP_TIMEOUT_MS,
	resolveUpdateChannel,
	appPackageInstalled,
	upgradeArgv,
	upgradeEnv,
} from "./upgrade.js";

describe("launcherSteps (#717)", () => {
	const info = { node: "/n/node", launcher: "/usr/local/bin/pl", version: "0.5.6" };
	const sw = (...a: string[]) => ["/n/node", "/usr/local/bin/pl", "--launcher-switch", ...a, "--workspace", "/w"];
	it("switches to a nightly through the launcher alone", () => {
		expect(launcherSteps(info, "0.5.7-nightly.20261117.3", "/w", "linux")).toEqual({
			steps: [sw("nightly", "--version", "0.5.7-nightly.20261117.3")],
			undo: [],
		});
	});
	it("goes back to the launcher's own stable without npm, also when a stable overtook the nightly", () => {
		expect(launcherSteps(info, "0.5.6", "/w", "linux")).toEqual({ steps: [sw("stable")], undo: [] });
	});
	it("installs the requested stable's launcher first, newer or older, and undoes it if the switch fails", () => {
		for (const target of ["0.5.7", "0.5.5"])
			expect(launcherSteps(info, target, "/w", "linux")).toEqual({
				steps: [["npm", "install", "-g", `prismalens@${target}`], sw("stable")],
				undo: [["npm", "install", "-g", "prismalens@0.5.6"]],
			});
	});
});

describe("rollbackSteps (#717)", () => {
	const info = { node: "/n/node", launcher: "/usr/local/bin/pl", version: "0.5.7" };
	const sw = (...a: string[]) => ["/n/node", "/usr/local/bin/pl", "--launcher-switch", ...a, "--workspace", "/w"];
	const trial = { from: "0.5.6", to: "0.5.7", channel: "npm", startedAt: "t" };
	it("puts back the recorded stable runtime: its launcher first, never the shared previous", () => {
		const steps = rollbackSteps(
			info,
			{ ...trial, runtime: { channel: "stable", version: "0.5.6", launcher: "0.5.6" } },
			"/w",
			"linux",
		);
		expect(steps).toEqual([["npm", "install", "-g", "prismalens@0.5.6"], sw("stable")]);
	});
	it("puts back the recorded nightly by its version, with no npm step for a nightly trial", () => {
		const steps = rollbackSteps(
			info,
			{
				...trial,
				from: "0.5.7-nightly.20261117.3",
				to: "0.5.7-nightly.20261118.4",
				runtime: { channel: "nightly", version: "0.5.7-nightly.20261117.3", launcher: "0.5.6" },
			},
			"/w",
			"linux",
		);
		expect(steps).toEqual([sw("nightly", "--version", "0.5.7-nightly.20261117.3")]);
	});
	it("puts back the recorded stable when a pruned nightly's fallback ran a stable other than the launcher's own", () => {
		// Launcher 0.5.6 fell back to the previous stable 0.5.5 (cr-4602067336 in scripts/launcher/runtime.test.mjs).
		const fallback = { channel: "stable" as const, version: "0.5.5", launcher: "0.5.6" };
		const info6 = { ...info, version: "0.5.6" };
		for (const to of ["0.5.7-nightly.20261118.4", "0.5.7"])
			expect(rollbackSteps(info6, { ...trial, from: "0.5.5", to, runtime: fallback }, "/w", "linux")).toEqual([
				["npm", "install", "-g", "prismalens@0.5.5"],
				sw("stable"),
			]);
	});
	it("reinstalls npm's own package for a trial 0.5.1-0.5.5 left, which ran no launcher, never the shared previous", () => {
		const left = { from: "0.5.5", to: "0.5.6", channel: "npm", startedAt: "t" };
		expect(rollbackSteps(info, left, "/w", "linux")).toEqual([["npm", "install", "-g", "prismalens@0.5.5"]]);
	});
});

describe("runSteps (#717)", () => {
	it("stops at the failing step, runs the undo and names what failed", () => {
		const ran: string[] = [];
		const spawn = (argv: string[]) => {
			ran.push(argv.join(" "));
			return argv.includes("--launcher-switch")
				? { status: 1, signal: null }
				: { status: 0, signal: null };
		};
		const r = runSteps([["npm", "install", "-g", "prismalens@0.5.7"], ["n", "l", "--launcher-switch", "stable"]], [["npm", "install", "-g", "prismalens@0.5.6"]], spawn);
		expect(r).toEqual({ ok: false, failed: "n l --launcher-switch stable (exited 1)", undone: true });
		expect(ran).toEqual(["npm install -g prismalens@0.5.7", "n l --launcher-switch stable", "npm install -g prismalens@0.5.6"]);
	});
	it("reports a step killed at its deadline", () => {
		const r = runSteps([["slow"]], [], () => ({ status: null, signal: "SIGTERM", error: new Error("spawnSync slow ETIMEDOUT") }));
		expect(r).toEqual({ ok: false, failed: "slow (spawnSync slow ETIMEDOUT)", undone: true });
		expect(STEP_TIMEOUT_MS).toBe(20 * 60 * 1000);
	});
	it("is ok when every step exits 0", () => {
		expect(runSteps([["a"], ["b"]], [["undo"]], () => ({ status: 0 }))).toEqual({ ok: true });
	});
});

describe("launcherInfo", () => {
	it("is null outside the launcher", () => {
		expect(launcherInfo({})).toBeNull();
		expect(launcherInfo({ PRISMALENS_LAUNCHER: "/l", PRISMALENS_LAUNCHER_NODE: "/n", PRISMALENS_LAUNCHER_VERSION: "0.5.6" })).toEqual({ launcher: "/l", node: "/n", version: "0.5.6" });
	});
});

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
	it("upgrades the app's own Homebrew or Scoop package with the CLI when it is installed", () => {
		expect(upgradeArgv("homebrew", "0.5.1", "darwin", true)).toEqual(["brew", "upgrade", "prismalens", "prismalens-app"]);
		expect(upgradeArgv("scoop", "0.5.1", "win32", true)).toEqual([
			"cmd",
			"/c",
			"scoop",
			"update",
			"prismalens",
			"prismalens-app",
		]);
	});
});

describe("appPackageInstalled", () => {
	const brewNode = "/opt/homebrew/Cellar/prismalens/0.5.1/libexec/node/bin/node";
	const scoopNode = "C:\\Users\\ada\\scoop\\apps\\prismalens\\current\\node\\node.exe";

	it("finds the cask in the Caskroom beside Homebrew's Cellar", () => {
		const seen: string[] = [];
		const found = appPackageInstalled("homebrew", brewNode, (p) => (seen.push(p), true));
		expect(found).toBe(true);
		expect(seen).toEqual(["/opt/homebrew/Caskroom/prismalens-app"]);
		expect(appPackageInstalled("homebrew", brewNode, () => false)).toBe(false);
	});

	it("finds Scoop's app beside the CLI's, and nothing for other channels", () => {
		const seen: string[] = [];
		expect(appPackageInstalled("scoop", scoopNode, (p) => (seen.push(p), true))).toBe(true);
		expect(seen.map((p) => p.replaceAll("\\", "/"))).toEqual(["C:/Users/ada/scoop/apps/prismalens-app"]);
		expect(appPackageInstalled("installer", "/home/ada/.local/share/prismalens/runtime/0.5.1/node/bin/node", () => true)).toBe(false);
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

	it("requested stable with env PRISMALENS_UPDATE_CHANNEL=nightly on the installer still follows stable, with both notes", () => {
		const workspace = mkdtempSync(join(tmpdir(), "pl-chan-"));
		try {
			const env = { PRISMALENS_UPDATE_CHANNEL: "nightly" };
			const res = resolveUpdateChannel(realConfig, workspace, "installer", "stable", env);
			expect(res).toEqual({
				channel: "stable",
				note: `Release channel saved as stable, but PRISMALENS_UPDATE_CHANNEL=nightly overrides it while it is set. This copy was installed with installer, so it follows stable. ${NIGHTLY_NPM_ONLY}`,
			});
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

describe("commandVersion", () => {
	it("names the resolved target on npm, so a nightly install offered stable is told that exact version", () => {
		expect(commandVersion("npm", null, "0.5.5")).toBe("0.5.5");
		expect(commandVersion("npm", "0.5.4-nightly.20261111.7", "0.5.4-nightly.20261111.7")).toBe(
			"0.5.4-nightly.20261111.7",
		);
	});

	it("names no version for an unpinned non-npm upgrade, and the pin when there is one", () => {
		expect(commandVersion("homebrew", null, "0.5.5")).toBe(undefined);
		expect(commandVersion("installer", "0.5.5", "0.5.5")).toBe("0.5.5");
	});
});
