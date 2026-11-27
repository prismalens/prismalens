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
	isLink: (path: string) => boolean;
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

/**
 * Exec's value per the Desktop Entry spec, as the installer writes it: a quoted argument
 * (\ " ` $ escaped), then the string escape (\ doubled) and the field-code escape (% doubled).
 */
export function desktopExecValue(path: string): string {
	const quoted = `"${path.replace(/[\\"`$]/g, "\\$&")}"`;
	return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}

export function desktopEntry(execPath: string, icon: string | null): string {
	return [
		"[Desktop Entry]",
		"Type=Application",
		"Name=PrismaLens",
		"Comment=Investigate alerts with the coding agent you already use",
		`Exec=${desktopExecValue(execPath)}`,
		...(icon ? [`Icon=${icon.replace(/\\/g, "\\\\")}`] : []),
		"Terminal=false",
		"Categories=Development;",
		"StartupWMClass=PrismaLens",
		DESKTOP_ENTRY_MARKER,
		"",
	].join("\n");
}

/** The program an entry's Exec line runs: the spec's escapes undone, quoted or not. */
export function desktopEntryExec(text: string): string | null {
	const raw = /^Exec=(.*)$/m.exec(text)?.[1]?.trim();
	if (!raw) return null;
	const line = raw
		.replace(/\\(.)/g, (_, c: string) =>
			c === "s" ? " " : c === "\\" ? "\\" : `\\${c}`,
		)
		.replace(/%%/g, "%");
	if (!line.startsWith('"')) return line.split(/\s+/)[0] ?? null;
	let out = "";
	for (let i = 1; i < line.length; i++) {
		const c = line[i];
		if (c === '"') return out;
		if (c === "\\" && i + 1 < line.length) {
			i++;
			out += line[i];
		} else out += c;
	}
	return null;
}

const samePath = (a: string, b: string, platform: NodeJS.Platform) =>
	platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * What to do about the launcher for this copy. An existing launcher that opens another copy which
 * still exists is left alone: the user may run a downloaded copy beside an installed one. A copy
 * a package manager installed has that manager's launcher, so it adds none.
 */
export function planLauncher(
	env: LauncherEnv,
	readShortcut: (path: string) => Shortcut | null,
): LauncherPlan {
	if (env.platform === "win32") {
		const path = shortcutPath(env.appData);
		// Scoop keeps an app in <root>\apps\<name>\, and its root can be any folder.
		if (/[\\/]apps[\\/]prismalens-app[\\/]/i.test(env.execPath))
			return { kind: "none", reason: "Scoop's shortcut opens this copy" };
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
		if (!current) return { kind: "none", reason: `${path} can't be read` };
		if (!env.exists(current.target))
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
		if (/[\r\n]/.test(env.execPath))
			return {
				kind: "none",
				reason: `${env.execPath} has a line break, which a desktop entry can't hold`,
			};
		const icon = posix.join(env.resourcesPath, "icon.png");
		const contents = desktopEntry(env.execPath, env.exists(icon) ? icon : null);
		if (env.isLink(path)) return { kind: "none", reason: `${path} isn't ours` };
		if (!env.exists(path)) return { kind: "desktop-entry", path, contents };
		const text = env.readText(path);
		if (text === null) return { kind: "none", reason: `${path} can't be read` };
		if (!text.split("\n").includes(DESKTOP_ENTRY_MARKER))
			return { kind: "none", reason: `${path} isn't ours` };
		const exec = desktopEntryExec(text);
		// A bare name runs from PATH, so whether it still exists can't be told here.
		if (exec && !posix.isAbsolute(exec))
			return { kind: "none", reason: `${path} opens ${exec} from PATH` };
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
 * Its receipt says desktop=1 and names, as desktop_app, the app this copy runs from; paths compare canonical.
 */
export function installedByInstaller(input: {
	platform: NodeJS.Platform;
	execPath: string;
	receipt: string | null;
	realpath?: (path: string) => string;
}): boolean {
	if (!input.receipt || !/^desktop=1\r?$/m.test(input.receipt)) return false;
	const app = /^desktop_app=(.+?)\r?$/m.exec(input.receipt)?.[1];
	if (!app) return false;
	const real = input.realpath ?? ((path: string) => path);
	const p = input.platform === "win32" ? win32 : posix;
	const fold = (path: string) =>
		input.platform === "win32" ? path.toLowerCase() : path;
	const rel = p.relative(fold(real(app)), fold(real(input.execPath)));
	return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
}
