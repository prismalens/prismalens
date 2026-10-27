// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens in WSL (#767, walk u20): on Windows the window can attach to a
 * `pl` already running inside a WSL distro instead of starting its own packed
 * copy. The app never starts or stops anything in the distro (ADR 0005 §8: a
 * launcher and a client); the distro keeps its own workspace and agent
 * sign-in, and the window reaches it through WSL's localhost forwarding.
 * Everything here is pure so it is testable off Windows.
 */

import type { WorkspaceLockState } from "@prismalens/config";
import type { BackendSpawn, Target } from "./supervisor.js";

export interface WslSettings {
	enabled: boolean;
	distro: string | null;
	/** Distros that failed the last check, with the reason the tray shows (#908). */
	unusable: Readonly<Record<string, string>>;
}

export const WSL_OFF: WslSettings = {
	enabled: false,
	distro: null,
	unusable: {},
};

/** Stored settings, defaulting to off for anything missing or malformed. */
export function parseWslSettings(raw: string | null): WslSettings {
	if (!raw) return WSL_OFF;
	try {
		const value = JSON.parse(raw) as Record<string, unknown> | null;
		const unusable =
			value?.unusable && typeof value.unusable === "object"
				? Object.fromEntries(
						Object.entries(value.unusable).filter(
							(entry): entry is [string, string] =>
								typeof entry[1] === "string",
						),
					)
				: {};
		return {
			enabled: value?.enabled === true,
			distro:
				typeof value?.distro === "string" && value.distro ? value.distro : null,
			unusable,
		};
	} catch {
		return WSL_OFF;
	}
}

/** Only Windows has WSL; elsewhere the setting is ignored, whatever is stored. */
export function wslActive(
	platform: NodeJS.Platform,
	settings: WslSettings,
): boolean {
	return platform === "win32" && settings.enabled;
}

function utf16Lines(stdout: Buffer | string): string[] {
	const text = typeof stdout === "string" ? stdout : stdout.toString("utf16le");
	return text.replace(/^﻿/, "").replace(/\0/g, "").split(/\r?\n/);
}

/** `wsl.exe -l -q` prints UTF-16LE, one distro per line. */
export function parseDistros(stdout: Buffer | string): string[] {
	return utf16Lines(stdout)
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** `wsl.exe -l -v` marks the default distro's row with `*`. */
export function parseDefaultDistro(stdout: Buffer | string): string | null {
	for (const line of utf16Lines(stdout)) {
		const match = /^\s*\*\s+(\S+)/.exec(line);
		if (match) return match[1];
	}
	return null;
}

/**
 * wsl.exe re-escapes arguments and mangles quotes in `bash -lc "<script>"`,
 * so the script goes in on stdin to a login shell (#767).
 */
export function wslShell(distro: string | null): {
	command: string;
	args: string[];
} {
	return {
		command: "wsl.exe",
		args: [...(distro ? ["-d", distro] : []), "--", "bash", "-l", "-s"],
	};
}

/**
 * A login shell skips the nvm lines most ~/.bashrc files hold, so load nvm
 * here; drop /mnt/* PATH entries so `pl` is never Windows' npm shim (#767).
 */
export const PATH_PREAMBLE = `export NVM_DIR="\${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; nvm use default >/dev/null 2>&1; fi
if ! command -v node >/dev/null 2>&1; then
  for b in "$NVM_DIR"/versions/node/*/bin; do [ -x "$b/node" ] && PATH="$b:$PATH"; done
fi
PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
PATH=$(printf %s "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)
export PATH
`;

/** Reads the distro's default workspace: lock, owner liveness, port, `pl`, service unit. */
export const PROBE_SCRIPT = `d="\${PRISMALENS_WORKSPACE_DIR:-$HOME/.prismalens}"
command -v pl >/dev/null 2>&1 && echo "pl=1"
[ -f "$HOME/.config/systemd/user/prismalens.service" ] && echo "service=1"
[ -f "$d/instance.json" ] && echo "instance=$(tr -d '\\n' < "$d/instance.json")"
if [ -f "$d/prismalens.lock" ]; then
  echo "lock=$(cat "$d/prismalens.lock")"
  pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$d/prismalens.lock")
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "alive=1"
fi
exit 0
`;

export interface WslProbe {
	hasPl: boolean;
	hasService: boolean;
	lock: WorkspaceLockState;
	/** The workspace's own port; null before its first `pl up`. */
	port: number | null;
	/** The workspace's instance id, from the same `instance.json`. */
	instanceId: string | null;
}

export function parseProbe(stdout: string): WslProbe {
	const fields = new Map<string, string>();
	for (const line of stdout.split(/\r?\n/)) {
		const at = line.indexOf("=");
		if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1));
	}
	const json = (key: string): Record<string, unknown> | null => {
		try {
			return JSON.parse(fields.get(key) ?? "") as Record<string, unknown>;
		} catch {
			return null;
		}
	};
	const instance = json("instance");
	const port = Number.isInteger(instance?.port) ? Number(instance?.port) : null;
	const owner = json("lock");
	let lock: WorkspaceLockState = { kind: "free" };
	if (fields.has("lock")) {
		lock =
			owner &&
			Number.isInteger(owner.pid) &&
			Number.isInteger(owner.port) &&
			typeof owner.startedAt === "string"
				? {
						kind: fields.has("alive") ? "held" : "stale",
						owner: {
							pid: owner.pid as number,
							port: owner.port as number,
							startedAt: owner.startedAt,
						},
					}
				: { kind: "unreadable", ageMs: 0 };
	}
	return {
		hasPl: fields.get("pl") === "1",
		hasService: fields.get("service") === "1",
		lock,
		port,
		instanceId:
			typeof instance?.instanceId === "string" && instance.instanceId
				? instance.instanceId
				: null,
	};
}

export type WslPlan =
	| { kind: "attach"; target: Target; pid: number }
	| { kind: "none"; reason: "nothing-running" };

/**
 * Attach to the live owner, reached on localhost whatever the bind inside the
 * distro; anything else is nothing running, which is a dialog, never a spawn.
 */
export function planWslLaunch(probe: WslProbe): WslPlan {
	if (probe.lock.kind === "held") {
		return {
			kind: "attach",
			pid: probe.lock.owner.pid,
			target: {
				protocol: "http",
				host: "localhost",
				port: probe.lock.owner.port,
			},
		};
	}
	return { kind: "none", reason: "nothing-running" };
}

/** A script for `wslShell`'s stdin, and the distro it runs in. */
export interface WslRun extends BackendSpawn {
	script: string;
}

function run(distro: string | null, script: string): WslRun {
	const { command, args } = wslShell(distro);
	return { command, args, env: process.env, script: PATH_PREAMBLE + script };
}

export function wslProbe(distro: string | null): WslRun {
	return run(distro, PROBE_SCRIPT);
}

export function wslPairOperator(distro: string | null): WslRun {
	return run(distro, "pl pair --operator\n");
}

const RUN_ON_WINDOWS = "Run on Windows instead";

export const MISSING_PL_BUTTONS = [RUN_ON_WINDOWS, "Retry", "Quit"] as const;

function where(distro: string | null, defaultName: string | null): string {
	return distro
		? `the ${distro} WSL distro`
		: defaultName
			? `the default WSL distro (${defaultName})`
			: "the default WSL distro";
}

/** No `pl` in the distro (#673 w49); `defaultName` names WSL's default distro when known. */
export function wslMissingPl(
	distro: string | null,
	defaultName: string | null = null,
): {
	message: string;
	detail: string;
	buttons: string[];
} {
	return {
		message: `PrismaLens is not installed in ${where(distro, defaultName)}`,
		detail:
			"Install it there (npm install -g prismalens) so `pl` is on the login shell's PATH, or run PrismaLens on Windows instead.",
		buttons: [...MISSING_PL_BUTTONS],
	};
}

/**
 * Why `wsl.exe` could not run the probe's shell in a distro, short enough for
 * a menu label. Container engines' own distros have no bash (#908).
 */
export function wslFailureReason(output: string): string {
	const text = output.replace(/\0/g, "");
	if (
		/WSL_E_DISTRO_NOT_FOUND|no distribution with the supplied name/i.test(text)
	)
		return "not installed";
	if (/bash: not found|execvpe\(bash\)|bash: No such file/i.test(text))
		return "no bash";
	if (/wsl\.exe ENOENT/.test(text)) return "WSL is not installed";
	return "WSL could not start it";
}

/** A distro that failed the check: at boot with a way back to Windows, from the tray with OK. */
export function wslUnusable(input: {
	distro: string | null;
	defaultName: string | null;
	reason: string;
	atBoot: boolean;
}): { message: string; detail: string; buttons: string[] } {
	const needs =
		"PrismaLens needs a Linux distro with bash, and PrismaLens installed in it.";
	return {
		message: `PrismaLens can't run in ${where(input.distro, input.defaultName)}: ${input.reason}`,
		detail: input.atBoot
			? `${needs} Run it on Windows instead, then pick another distro from the tray's WSL distro menu.`
			: `${needs} Your choice was not saved; pick another distro.`,
		buttons: input.atBoot ? [...MISSING_PL_BUTTONS] : ["OK"],
	};
}

export const NOTHING_RUNNING_BUTTONS = [
	"Retry",
	RUN_ON_WINDOWS,
	"Quit",
] as const;

/** The dialog for a distro with `pl` installed and nothing listening. */
export function wslNothingRunning(distro: string | null): {
	message: string;
	detail: string;
	buttons: string[];
} {
	return {
		message: `Nothing is running in ${distro ?? "the default WSL distro"}`,
		detail: "Run `pl up` there, or `pl service install` once. Then Retry.",
		buttons: [...NOTHING_RUNNING_BUTTONS],
	};
}

export type NothingRunningChoice =
	| { kind: "retry" }
	| { kind: "relaunch"; settings: WslSettings }
	| { kind: "quit" };

function wslDialogChoice(
	settings: WslSettings,
	label: string | undefined,
): NothingRunningChoice {
	switch (label) {
		case "Retry":
			return { kind: "retry" };
		case RUN_ON_WINDOWS:
			return { kind: "relaunch", settings: { ...settings, enabled: false } };
		default:
			return { kind: "quit" };
	}
}

/** What the dialog's button index means; "Run on Windows instead" turns the switch off. */
export function nothingRunningChoice(
	settings: WslSettings,
	response: number,
): NothingRunningChoice {
	return wslDialogChoice(settings, NOTHING_RUNNING_BUTTONS[response]);
}

/** The same for the missing-`pl` and unusable-distro dialogs, whose buttons come in another order. */
export function missingPlChoice(
	settings: WslSettings,
	response: number,
): NothingRunningChoice {
	return wslDialogChoice(settings, MISSING_PL_BUTTONS[response]);
}

/** The Windows copy's port is held by the PrismaLens running in WSL (#673 w50). */
export function portTakenByWslDialog(input: {
	port: number;
	distro: string | null;
	/** A free port to run a Windows copy on instead (#673 w50). */
	freePort?: number | null;
}): { message: string; detail: string; buttons: string[]; freePort?: number } {
	return {
		message: `Port ${input.port} is used by the PrismaLens running in WSL (${input.distro ?? "the default distro"})`,
		detail: input.freePort
			? `Use it from this app, or run this app's own copy on port ${input.freePort}.`
			: "Use it from this app, or stop it in WSL and relaunch to run a Windows copy here.",
		buttons: input.freePort
			? [
					"Use the PrismaLens in WSL",
					`Start here on port ${input.freePort}`,
					"Quit",
				]
			: ["Use the PrismaLens in WSL", "Quit"],
		...(input.freePort ? { freePort: input.freePort } : {}),
	};
}

/** WSL refuses an empty distro name, so this key can't collide with one. */
export const UNNAMED_DEFAULT = "";

/**
 * Settings after a check of `name`: its reason recorded, or cleared when it
 * passed. Null is the default distro when `wsl.exe` didn't name it.
 */
export function withCheck(
	settings: WslSettings,
	name: string | null,
	reason: string | null,
): WslSettings {
	const key = name ?? UNNAMED_DEFAULT;
	const { [key]: _cleared, ...rest } = settings.unusable;
	return { ...settings, unusable: reason ? { ...rest, [key]: reason } : rest };
}

export const WSL_TOGGLE_LABEL = "Use PrismaLens in WSL";

export interface WslMenuItem {
	label: string;
	type: "checkbox" | "radio";
	checked: boolean;
	distro?: string | null;
}

/**
 * The tray's WSL items: a switch, then one radio per distro (first = WSL's
 * default, named when known). A distro that failed its check carries the
 * reason and stays clickable, since a click checks it again (#908).
 */
export function wslMenuItems(
	settings: WslSettings,
	distros: string[],
	defaultDistro: string | null = null,
): { toggle: WslMenuItem; distros: WslMenuItem[] } {
	const why = (name: string | null) => {
		const reason = settings.unusable[name ?? UNNAMED_DEFAULT];
		return reason ? ` (${reason})` : "";
	};
	// A saved distro that WSL no longer lists keeps its item, so it can be rechecked.
	const names =
		settings.distro && !distros.includes(settings.distro)
			? [...distros, settings.distro]
			: distros;
	return {
		toggle: {
			label: WSL_TOGGLE_LABEL,
			type: "checkbox",
			checked: settings.enabled,
		},
		distros: [
			{
				label: defaultDistro
					? `Default distro (${defaultDistro})${why(defaultDistro)}`
					: `Default distro${why(null)}`,
				type: "radio",
				checked: settings.distro === null,
				distro: null,
			},
			...names.map((name) => ({
				label: `${name}${why(name)}`,
				type: "radio" as const,
				checked: settings.distro === name,
				distro: name,
			})),
		],
	};
}
