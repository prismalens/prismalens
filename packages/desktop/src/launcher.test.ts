// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
	APP_USER_MODEL_ID,
	DESKTOP_ENTRY_MARKER,
	desktopEntry,
	desktopEntryExec,
	installedByInstaller,
	type LauncherEnv,
	planLauncher,
	type Shortcut,
} from "./launcher.js";

const winExe = "C:\\Users\\ada\\Downloads\\win-unpacked\\PrismaLens.exe";
const lnk = win32.join("C:\\Users\\ada\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "PrismaLens.lnk");
const linuxExe = "/home/ada/Downloads/linux-unpacked/prismalens";
const linuxIcon = "/home/ada/Downloads/linux-unpacked/resources/icon.png";
const entryPath = posix.join("/home/ada/.local/share", "applications", "prismalens.desktop");

function env(platform: NodeJS.Platform, files: Record<string, string>, over: Partial<LauncherEnv> = {}): LauncherEnv {
	return {
		platform,
		execPath: platform === "win32" ? winExe : linuxExe,
		resourcesPath: "/home/ada/Downloads/linux-unpacked/resources",
		home: "/home/ada",
		appData: "C:\\Users\\ada\\AppData\\Roaming",
		// Windows paths are case-insensitive, as on its file system.
		exists: (p) =>
			platform === "win32"
				? Object.keys(files).some((f) => f.toLowerCase() === p.toLowerCase())
				: p in files,
		readText: (p) => files[p] ?? null,
		isLink: () => false,
		...over,
	};
}
const noShortcut = () => null;
const shortcutTo = (s: Shortcut) => () => s;
const winOptions = {
	target: winExe,
	icon: winExe,
	iconIndex: 0,
	appUserModelId: APP_USER_MODEL_ID,
	description: "PrismaLens desktop app",
};

describe("planLauncher on Windows", () => {
	it("creates a Start menu shortcut to this copy, with its icon and AppUserModelID, when there is none", () => {
		expect(planLauncher(env("win32", {}), noShortcut)).toEqual({
			kind: "shortcut",
			path: lnk,
			operation: "create",
			options: winOptions,
		});
	});

	it("adds the AppUserModelID to the installer's shortcut to this copy", () => {
		const files = { [lnk]: "", [winExe]: "" };
		expect(planLauncher(env("win32", files), shortcutTo({ target: winExe.toUpperCase() }))).toEqual({
			kind: "shortcut",
			path: lnk,
			operation: "update",
			options: winOptions,
		});
	});

	it("replaces a shortcut whose app was deleted", () => {
		const files = { [lnk]: "" };
		expect(planLauncher(env("win32", files), shortcutTo({ target: "C:\\gone\\PrismaLens.exe" }))).toMatchObject({
			kind: "shortcut",
			operation: "replace",
		});
	});

	it("leaves a shortcut to another copy that still exists, and one already up to date", () => {
		const other = "C:\\Users\\ada\\AppData\\Local\\prismalens\\desktop\\0.5.7\\PrismaLens.exe";
		expect(planLauncher(env("win32", { [lnk]: "", [other]: "" }), shortcutTo({ target: other }))).toEqual({
			kind: "none",
			reason: `${lnk} opens ${other}`,
		});
		const current = { target: winExe, appUserModelId: APP_USER_MODEL_ID };
		expect(planLauncher(env("win32", { [lnk]: "", [winExe]: "" }), shortcutTo(current))).toEqual({
			kind: "none",
			reason: "up to date",
		});
	});
});

describe("planLauncher on Linux", () => {
	it("writes a desktop entry under XDG_DATA_HOME that runs this copy with its icon", () => {
		const plan = planLauncher(env("linux", { [linuxIcon]: "" }, { xdgDataHome: "/xdg" }), noShortcut);
		expect(plan).toEqual({
			kind: "desktop-entry",
			path: posix.join("/xdg", "applications", "prismalens.desktop"),
			contents: [
				"[Desktop Entry]",
				"Type=Application",
				"Name=PrismaLens",
				"Comment=Investigate alerts with the coding agent you already use",
				`Exec="${linuxExe}"`,
				`Icon=${linuxIcon}`,
				"Terminal=false",
				"Categories=Development;",
				"StartupWMClass=PrismaLens",
				DESKTOP_ENTRY_MARKER,
				"",
			].join("\n"),
		});
	});

	it("rewrites its own entry once that entry's app is gone, and leaves an entry it didn't write", () => {
		const stale = desktopEntry("/gone/prismalens", null);
		expect(planLauncher(env("linux", { [entryPath]: stale }), noShortcut)).toEqual({
			kind: "desktop-entry",
			path: entryPath,
			contents: desktopEntry(linuxExe, null),
		});
		const theirs = "[Desktop Entry]\nExec=/opt/prismalens/prismalens\n";
		expect(planLauncher(env("linux", { [entryPath]: theirs }), noShortcut)).toEqual({
			kind: "none",
			reason: `${entryPath} isn't ours`,
		});
	});

	it("leaves the installer's entry to an installed copy that still exists", () => {
		const installed = "/home/ada/.local/share/prismalens/desktop/app/prismalens";
		const files = { [entryPath]: desktopEntry(installed, null), [installed]: "" };
		expect(planLauncher(env("linux", files), noShortcut)).toEqual({
			kind: "none",
			reason: `${entryPath} opens ${installed}`,
		});
	});
});

describe("planLauncher on macOS", () => {
	const exe = (dir: string) => `${dir}/PrismaLens.app/Contents/MacOS/PrismaLens`;

	it("offers the move from Downloads", () => {
		expect(planLauncher(env("darwin", {}, { execPath: exe("/Users/ada/Downloads/mac-arm64") }), noShortcut)).toEqual({
			kind: "offer-move",
		});
	});

	it.each(["/Applications", "/home/ada/Applications"])("stays quiet in %s", (dir) => {
		expect(planLauncher(env("darwin", {}, { execPath: exe(dir) }), noShortcut)).toEqual({
			kind: "none",
			reason: "in Applications",
		});
	});
});

describe("planLauncher beside a package manager or a launcher it can't read", () => {
	it("adds no shortcut for Scoop's copy at any Scoop root, and leaves a shortcut it can't read", () => {
		const scoopExe = String.raw`C:\Users\ada\scoop\apps\prismalens-app\current\PrismaLens.exe`;
		expect(planLauncher(env("win32", {}, { execPath: scoopExe }), noShortcut)).toEqual({
			kind: "none",
			reason: "Scoop's shortcut opens this copy",
		});
		const customRoot = String.raw`D:\Tools\Store\apps\prismalens-app\0.5.6\PrismaLens.exe`;
		expect(planLauncher(env("win32", {}, { execPath: customRoot }), noShortcut)).toEqual({
			kind: "none",
			reason: "Scoop's shortcut opens this copy",
		});
		expect(planLauncher(env("win32", { [lnk]: "" }), noShortcut)).toEqual({
			kind: "none",
			reason: `${lnk} can't be read`,
		});
	});

	it("leaves a symlinked desktop entry alone, even one carrying the marker", () => {
		const linked = env("linux", { [entryPath]: desktopEntry("/gone/prismalens", null) }, { isLink: (p) => p === entryPath });
		expect(planLauncher(linked, noShortcut)).toEqual({ kind: "none", reason: `${entryPath} isn't ours` });
	});

	it("leaves a desktop entry that exists but can't be read", () => {
		const unreadable = env("linux", { [entryPath]: "" }, { readText: () => null });
		expect(planLauncher(unreadable, noShortcut)).toEqual({ kind: "none", reason: `${entryPath} can't be read` });
	});

	it("leaves a marked entry whose program is found on PATH", () => {
		const onPath = env("linux", { [entryPath]: `[Desktop Entry]\nExec=prismalens\n${DESKTOP_ENTRY_MARKER}\n` });
		expect(planLauncher(onPath, noShortcut)).toEqual({ kind: "none", reason: `${entryPath} opens prismalens from PATH` });
	});

	it("writes no entry for a path with a line break, which an entry can't hold", () => {
		const broken = env("linux", {}, { execPath: "/home/ada/a\nb/prismalens" });
		expect(planLauncher(broken, noShortcut)).toEqual({
			kind: "none",
			reason: "/home/ada/a\nb/prismalens has a line break, which a desktop entry can't hold",
		});
	});
});

describe("desktopEntry escaping", () => {
	it("writes Exec with the spec's escapes, and reads the same path back", () => {
		const odd = '/home/ada/100%QA/a b/x"y$z/prismalens';
		expect(desktopEntry(odd, null)).toContain(String.raw`Exec="/home/ada/100%%QA/a b/x\\"y\\$z/prismalens"`);
		expect(desktopEntryExec(desktopEntry(odd, null))).toBe(odd);
	});
});

describe("desktopEntryExec", () => {
	it("reads a quoted path with spaces and an unquoted one with arguments", () => {
		expect(desktopEntryExec('[Desktop Entry]\nExec="/a b/prismalens" %U\n')).toBe("/a b/prismalens");
		expect(desktopEntryExec("[Desktop Entry]\nExec=/opt/pl/prismalens --x\n")).toBe("/opt/pl/prismalens");
		expect(desktopEntryExec("[Desktop Entry]\nName=x\n")).toBe(null);
	});
});

describe("installedByInstaller", () => {
	const receipt = (app: string) => `version=0.5.7\nchannel=installer\ndesktop=1\ndesktop_app=${app}\n`;
	const winApp = "C:\\Users\\ada\\AppData\\Local\\prismalens\\desktop\\0.5.7\\PrismaLens.exe";
	const linuxApp = "/home/ada/.local/share/prismalens/desktop/app";
	const macApp = "/Users/ada/Applications/PrismaLens.app";

	it("is the installer's copy where its receipt names the app this copy runs from", () => {
		expect(installedByInstaller({ platform: "win32", execPath: winApp.toLowerCase(), receipt: receipt(winApp) })).toBe(true);
		expect(installedByInstaller({ platform: "linux", execPath: `${linuxApp}/prismalens`, receipt: receipt(linuxApp) })).toBe(true);
		expect(
			installedByInstaller({ platform: "darwin", execPath: `${macApp}/Contents/MacOS/PrismaLens`, receipt: receipt(macApp) }),
		).toBe(true);
	});

	it("compares canonical paths, so a symlinked home still matches", () => {
		const realpath = (p: string) => p.replace(/^\/home\//, "/var/home/");
		expect(
			installedByInstaller({
				platform: "linux",
				execPath: "/var/home/ada/.local/share/prismalens/desktop/app/prismalens",
				receipt: receipt(linuxApp),
				realpath,
			}),
		).toBe(true);
	});

	it("is not for a copy the receipt doesn't name, even where desktop=1 and the path is the usual one", () => {
		expect(
			installedByInstaller({
				platform: "darwin",
				execPath: `${macApp}/Contents/MacOS/PrismaLens`,
				receipt: "version=0.5.7\ndesktop=1\n",
			}),
		).toBe(false);
		expect(
			installedByInstaller({ platform: "linux", execPath: "/home/ada/Downloads/linux-unpacked/prismalens", receipt: receipt(linuxApp) }),
		).toBe(false);
		expect(
			installedByInstaller({ platform: "linux", execPath: `${linuxApp}-other/prismalens`, receipt: receipt(linuxApp) }),
		).toBe(false);
		expect(
			installedByInstaller({
				platform: "linux",
				execPath: `${linuxApp}/prismalens`,
				receipt: `version=0.5.7\ndesktop=0\ndesktop_app=${linuxApp}\n`,
			}),
		).toBe(false);
		expect(installedByInstaller({ platform: "linux", execPath: `${linuxApp}/prismalens`, receipt: null })).toBe(false);
	});
});
