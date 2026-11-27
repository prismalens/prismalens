// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The app's launcher in the OS's usual place, for a copy run straight from its download: a Start menu
 * shortcut on Windows, a desktop entry on Linux, and the offer to move into Applications on macOS.
 * The installers write the same launcher; this keeps it pointing at a copy that exists.
 */

import { mkdirSync, writeFileSync } from "node:fs";
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
	| { kind: "none"; reason: string; notice?: string }
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
		// env is argv[0]: GLib looks argv[0] up before it turns %% back into %, so a % path hid the entry.
		`Exec=env ${desktopExecValue(execPath)}`,
		...(icon ? [`Icon=${icon.replace(/\\/g, "\\\\")}`] : []),
		"Terminal=false",
		"Categories=Development;",
		"StartupWMClass=PrismaLens",
		DESKTOP_ENTRY_MARKER,
		"",
	].join("\n");
}

/** The program an entry's Exec line runs, past the env or /bin/sh that starts it; the spec's escapes undone. */
export function desktopEntryExec(text: string): string | null {
	const raw = /^Exec=(.*)$/m.exec(text)?.[1]?.trim();
	if (!raw) return null;
	const line = raw
		.replace(/\\(.)/g, (_, c: string) =>
			c === "s" ? " " : c === "\\" ? "\\" : `\\${c}`,
		)
		.replace(/%%/g, "%");
	const args: string[] = [];
	let i = 0;
	while (i < line.length) {
		if (/\s/.test(line[i] ?? "")) {
			i++;
			continue;
		}
		let arg = "";
		if (line[i] === '"') {
			for (i++; i < line.length && line[i] !== '"'; i++) {
				if (line[i] === "\\" && i + 1 < line.length) i++;
				arg += line[i];
			}
			i++;
		} else {
			for (; i < line.length && !/\s/.test(line[i] ?? ""); i++) arg += line[i];
		}
		args.push(arg);
	}
	const starter = ["env", "/usr/bin/env", "/bin/sh"].includes(args[0] ?? "");
	return (starter ? args[1] : args[0]) ?? null;
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
				notice:
					"PrismaLens can't add itself to your app menu: its folder's path has a line break, which a menu entry can't hold. Move the app to a folder without one to get its menu entry.",
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
 * Its receipt says desktop=1 and names, as desktop_app, the app this copy runs from (paths compare
 * canonical), and that app still carries the receipt's desktop_app_id: another app put in its place doesn't.
 */
export function installedByInstaller(input: {
	platform: NodeJS.Platform;
	execPath: string;
	receipt: string | null;
	installId: (app: string) => string | null;
	realpath?: (path: string) => string;
}): boolean {
	if (!input.receipt || !/^desktop=1\r?$/m.test(input.receipt)) return false;
	const app = /^desktop_app=(.+?)\r?$/m.exec(input.receipt)?.[1];
	const id = /^desktop_app_id=(.+?)\r?$/m.exec(input.receipt)?.[1];
	if (!app || !id || input.installId(app) !== id) return false;
	const real = input.realpath ?? ((path: string) => path);
	const p = input.platform === "win32" ? win32 : posix;
	const fold = (path: string) =>
		input.platform === "win32" ? path.toLowerCase() : path;
	const rel = p.relative(fold(real(app)), fold(real(input.execPath)));
	return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
}

export type LauncherIo = {
	notify: (message: string) => Promise<void>;
	warn: (message: string) => void;
	mkdir: (dir: string) => void;
	writeShortcut: (
		path: string,
		operation: "create" | "update" | "replace",
		options: Extract<LauncherPlan, { kind: "shortcut" }>["options"],
	) => void;
	writeFile: (path: string, contents: string) => void;
};

/** The LauncherIo the app runs with: notices in Electron's message box, files through Node. */
export function launcherIo(
	electron: {
		dialog: {
			showMessageBox: (options: {
				title: string;
				message: string;
			}) => Promise<unknown>;
		};
		shell: {
			writeShortcutLink: (
				...args: Parameters<LauncherIo["writeShortcut"]>
			) => boolean;
		};
	},
	title: string,
): LauncherIo {
	return {
		notify: async (message) => {
			await electron.dialog.showMessageBox({ title, message });
		},
		warn: (message) => console.warn(message),
		mkdir: (dir) => mkdirSync(dir, { recursive: true }),
		writeShortcut: (path, operation, options) => {
			if (!electron.shell.writeShortcutLink(path, operation, options))
				throw new Error(`couldn't write the Start menu shortcut ${path}`);
		},
		writeFile: (path, contents) => writeFileSync(path, contents),
	};
}

/** Carries out a plan: tells the user a notice, writes a shortcut or entry. The macOS move is main.ts's. */
export async function applyLauncherPlan(
	plan: LauncherPlan,
	io: LauncherIo,
): Promise<void> {
	if (plan.kind === "none" && plan.notice) {
		io.warn(`launcher: ${plan.reason}`);
		await io.notify(plan.notice);
	} else if (plan.kind === "shortcut") {
		io.mkdir(win32.dirname(plan.path));
		io.writeShortcut(plan.path, plan.operation, plan.options);
	} else if (plan.kind === "desktop-entry") {
		io.mkdir(posix.dirname(plan.path));
		io.writeFile(plan.path, plan.contents);
	}
}
