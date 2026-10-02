// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The WSL backend (#767): on Windows the app can run `pl` inside a WSL distro
 * instead of its own packed copy. It replaces the Windows backend rather than
 * sitting beside it: one window, one backend. The distro keeps its own
 * workspace and agent sign-in; the window reaches it through WSL's localhost
 * forwarding. Everything here is pure so it is testable off Windows.
 */

import type { WorkspaceLockState } from "@prismalens/config";
import type { BackendSpawn, LaunchPlan } from "./supervisor.js";

export interface WslSettings {
	enabled: boolean;
	distro: string | null;
}

export const WSL_OFF: WslSettings = { enabled: false, distro: null };

/** Stored settings, defaulting to off for anything missing or malformed. */
export function parseWslSettings(raw: string | null): WslSettings {
	if (!raw) return WSL_OFF;
	try {
		const value = JSON.parse(raw) as Partial<WslSettings> | null;
		return {
			enabled: value?.enabled === true,
			distro:
				typeof value?.distro === "string" && value.distro ? value.distro : null,
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

/** `wsl.exe -l -q` prints UTF-16LE, one distro per line. */
export function parseDistros(stdout: Buffer | string): string[] {
	const text = typeof stdout === "string" ? stdout : stdout.toString("utf16le");
	return text
		.replace(/^﻿/, "")
		.replace(/\0/g, "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
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
	};
}

const DEFAULT_PORT = 6473;

/**
 * The same order as the Windows launch: attach to the live owner, else start
 * the distro's service, else spawn `pl up` there. The window always reaches it
 * on localhost, whatever the bind inside the distro.
 */
export function planWslLaunch(probe: WslProbe): LaunchPlan {
	const target = (port: number) => ({
		protocol: "http" as const,
		host: "localhost",
		port,
	});
	if (probe.lock.kind === "held") {
		return {
			kind: "attach",
			pid: probe.lock.owner.pid,
			target: target(probe.lock.owner.port),
		};
	}
	const port = probe.port ?? DEFAULT_PORT;
	return probe.hasService
		? { kind: "service", target: target(port) }
		: { kind: "spawn", target: target(port) };
}

/** A script for `wslShell`'s stdin, and the distro it runs in. */
export interface WslRun extends BackendSpawn {
	script: string;
}

function run(distro: string | null, script: string): WslRun {
	const { command, args } = wslShell(distro);
	return { command, args, env: process.env, script };
}

export function wslProbe(distro: string | null): WslRun {
	return run(distro, PROBE_SCRIPT);
}

export function wslServiceStart(distro: string | null): WslRun {
	return run(distro, "systemctl --user start prismalens.service\n");
}

export function wslUp(distro: string | null): WslRun {
	return run(distro, "exec pl up --no-open\n");
}

export function wslPairOperator(distro: string | null): WslRun {
	return run(distro, "pl pair --operator\n");
}

export function wslMissingPl(distro: string | null): {
	message: string;
	detail: string;
} {
	const where = distro ? `the ${distro} WSL distro` : "the default WSL distro";
	return {
		message: `PrismaLens is not installed in ${where}`,
		detail:
			'Install it there (npm install -g prismalens) so `pl` is on the login shell\'s PATH, or turn off "Run in WSL" in the tray menu.',
	};
}

export interface WslMenuItem {
	label: string;
	type: "checkbox" | "radio";
	checked: boolean;
	distro?: string | null;
}

/** The tray's WSL items: a switch, then one radio per distro (first = WSL's default). */
export function wslMenuItems(
	settings: WslSettings,
	distros: string[],
): { toggle: WslMenuItem; distros: WslMenuItem[] } {
	return {
		toggle: {
			label: "Run in WSL",
			type: "checkbox",
			checked: settings.enabled,
		},
		distros: [
			{
				label: "Default distro",
				type: "radio",
				checked: settings.distro === null,
				distro: null,
			},
			...distros.map((name) => ({
				label: name,
				type: "radio" as const,
				checked: settings.distro === name,
				distro: name,
			})),
		],
	};
}
