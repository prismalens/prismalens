// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The app's launcher in the OS's usual place, for a copy run straight from its download: a Start menu
 * shortcut on Windows, a desktop entry on Linux, and the offer to move into Applications on macOS.
 * The installers write the same launcher; this keeps it pointing at a copy that exists.
 */

import { posix, win32 } from "node:path";

export const APP_USER_MODEL_ID = "io.prismalens.desktop";
/** The installers' marker too: an entry carrying it is ours to rewrite or remove. */
export const DESKTOP_ENTRY_MARKER = "X-PrismaLens-Installer=true";

export type Shortcut = { target: string; appUserModelId?: string };

export type LauncherEnv = {
	platform: NodeJS.Platform;
	execPath: string;
	resourcesPath: string;
	home: string;
	appData: string;
	xdgDataHome?: string;
	exists: (path: string) => boolean;
	readText: (path: string) => string | null;
};

export type LauncherPlan =
	| { kind: "none"; reason: string }
	| {
			kind: "shortcut";
			path: string;
			operation: "create" | "update" | "replace";
			options: {
				target: string;
				icon: string;
				iconIndex: number;
				appUserModelId: string;
				description: string;
			};
	  }
	| { kind: "desktop-entry"; path: string; contents: string }
	| { kind: "offer-move" };

export function shortcutPath(appData: string): string {
	return win32.join(
		appData,
		"Microsoft",
		"Windows",
		"Start Menu",
		"Programs",
		"PrismaLens.lnk",
	);
}

export function desktopEntryPath(
	env: Pick<LauncherEnv, "home" | "xdgDataHome">,
): string {
	return posix.join(
		env.xdgDataHome || posix.join(env.home, ".local", "share"),
		"applications",
		"prismalens.desktop",
	);
}

export function desktopEntry(execPath: string, icon: string | null): string {
	return [
		"[Desktop Entry]",
		"Type=Application",
		"Name=PrismaLens",
		"Comment=Investigate alerts with the coding agent you already use",
		`Exec="${execPath}"`,
		...(icon ? [`Icon=${icon}`] : []),
		"Terminal=false",
		"Categories=Development;",
		"StartupWMClass=PrismaLens",
		DESKTOP_ENTRY_MARKER,
		"",
	].join("\n");
}

/** The program an entry's Exec line runs, quoted or not. */
export function desktopEntryExec(text: string): string | null {
	const line = /^Exec=(.*)$/m.exec(text)?.[1]?.trim();
	if (!line) return null;
	return line.startsWith('"')
		? (line.slice(1).split('"')[0] ?? null)
		: (line.split(/\s+/)[0] ?? null);
}

const samePath = (a: string, b: string, platform: NodeJS.Platform) =>
	platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * What to do about the launcher for this copy. An existing launcher that opens another copy which
 * still exists is left alone: the user may run a downloaded copy beside an installed one.
 */
export function planLauncher(
	env: LauncherEnv,
	readShortcut: (path: string) => Shortcut | null,
): LauncherPlan {
	if (env.platform === "win32") {
		const path = shortcutPath(env.appData);
		const options = {
			target: env.execPath,
			icon: env.execPath,
			iconIndex: 0,
			appUserModelId: APP_USER_MODEL_ID,
			description: "PrismaLens desktop app",
		};
		if (!env.exists(path))
			return { kind: "shortcut", path, operation: "create", options };
		const current = readShortcut(path);
		if (!current || !env.exists(current.target))
			return { kind: "shortcut", path, operation: "replace", options };
		if (!samePath(current.target, env.execPath, env.platform))
			return { kind: "none", reason: `${path} opens ${current.target}` };
		// The installers' shortcut has no AppUserModelID, which Windows notifications key on.
		if (current.appUserModelId === APP_USER_MODEL_ID)
			return { kind: "none", reason: "up to date" };
		return { kind: "shortcut", path, operation: "update", options };
	}
	if (env.platform === "linux") {
		const path = desktopEntryPath(env);
		const icon = posix.join(env.resourcesPath, "icon.png");
		const contents = desktopEntry(env.execPath, env.exists(icon) ? icon : null);
		const text = env.readText(path);
		if (text === null) return { kind: "desktop-entry", path, contents };
		if (!text.includes(DESKTOP_ENTRY_MARKER))
			return { kind: "none", reason: `${path} isn't ours` };
		const exec = desktopEntryExec(text);
		if (exec && env.exists(exec) && exec !== env.execPath)
			return { kind: "none", reason: `${path} opens ${exec}` };
		return text === contents
			? { kind: "none", reason: "up to date" }
			: { kind: "desktop-entry", path, contents };
	}
	if (env.platform === "darwin") {
		// .../PrismaLens.app/Contents/MacOS/PrismaLens
		const bundleParent = posix.dirname(
			posix.dirname(posix.dirname(posix.dirname(env.execPath))),
		);
		if (
			bundleParent === "/Applications" ||
			bundleParent === posix.join(env.home, "Applications")
		)
			return { kind: "none", reason: "in Applications" };
		return { kind: "offer-move" };
	}
	return { kind: "none", reason: `no launcher on ${env.platform}` };
}

/**
 * Whether the official installer put this copy here, so `pl upgrade` (which reruns it) is how it upgrades.
 * Its receipt says desktop=1, and the copy sits where the installer puts the app.
 */
export function installedByInstaller(input: {
	platform: NodeJS.Platform;
	execPath: string;
	home: string;
	installerDataDir: string;
	receipt: string | null;
}): boolean {
	if (!input.receipt || !/^desktop=1\r?$/m.test(input.receipt)) return false;
	if (input.platform === "darwin")
		return (
			input.execPath ===
			posix.join(
				input.home,
				"Applications",
				"PrismaLens.app",
				"Contents",
				"MacOS",
				"PrismaLens",
			)
		);
	const p = input.platform === "win32" ? win32 : posix;
	const rel = p.relative(
		p.join(input.installerDataDir, "desktop"),
		input.execPath,
	);
	return rel !== "" && !rel.startsWith("..") && !p.isAbsolute(rel);
}
