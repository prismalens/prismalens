// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What gate-side-checks.mjs needs to run the same checks on Linux, macOS and Windows (#920):
// the agent-free PATH, the throwaway env, finding a binary the way each OS does, and ending a
// process tree. Pure of side effects except `killTree`, so the platform branches are testable.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/** Checks that apply to one platform alone; the rest run everywhere. */
const PLATFORM_ONLY = { rollback: ["linux"] };

/** Why a platform-only check does not apply elsewhere, for the report line. */
export const NOT_APPLICABLE = {
	rollback:
		"N/A: a trial upgrade and its rollback run under `pl service`, which is systemd-only",
};

/** @param {string[]} names @param {NodeJS.Platform} platform */
export function checksFor(names, platform = process.platform) {
	return names.filter(
		(n) => !PLATFORM_ONLY[n] || PLATFORM_ONLY[n].includes(platform),
	);
}

/** @param {string[]} names @param {NodeJS.Platform} platform */
export function notApplicable(names, platform = process.platform) {
	return names.filter(
		(n) => PLATFORM_ONLY[n] && !PLATFORM_ONLY[n].includes(platform),
	);
}

/**
 * The directories an agent-free PATH may hold besides the tools dir. On Windows `git` is found
 * where it lives; `node` and `npm` are copied and shimmed into the tools dir instead, because
 * node's own directory also holds whatever global npm installs (an agent's `.cmd`).
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.ProcessEnv} source
 * @param {{ git?: string | null }} [where]
 */
export function systemDirs(platform, source = process.env, where = {}) {
	if (platform !== "win32") return ["/usr/bin", "/bin"];
	const root = source.SystemRoot ?? source.windir ?? "C:\\Windows";
	return [
		...new Set(
			[
				join(root, "System32"),
				root,
				where.git ? dirname(where.git) : null,
			].filter(Boolean),
		),
	];
}

/**
 * Looks `bin` up on `pathEnv` the way the OS does: Windows tries each PATHEXT suffix.
 * @param {string} bin @param {string} pathEnv
 * @param {NodeJS.Platform} platform @param {string} [pathext]
 */
export function resolveOnPath(
	bin,
	pathEnv,
	platform = process.platform,
	pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
) {
	const names =
		platform === "win32"
			? [
					bin,
					...pathext
						.split(";")
						.filter(Boolean)
						.map((ext) => `${bin}${ext.toLowerCase()}`),
				]
			: [bin];
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		for (const name of names) {
			const found = join(dir, name);
			if (existsSync(found)) return found;
		}
	}
	return null;
}

/**
 * The env a check's `pl` runs in: a throwaway home on every OS, and the Windows variables that
 * name it. Nothing from the runner's own env except what the OS itself needs to start a process.
 * @param {{ platform?: NodeJS.Platform, home: string, tmp: string, source?: NodeJS.ProcessEnv }} options
 * @returns {Record<string, string>}
 */
export function baseEnv({
	platform = process.platform,
	home,
	tmp,
	source = process.env,
}) {
	/** @type {Record<string, string>} */
	const env = {
		HOME: home,
		TERM: "xterm-256color",
		TMPDIR: tmp,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_STATE_HOME: join(home, ".local", "state"),
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		CODEX_HOME: join(home, ".codex"),
	};
	if (platform !== "win32") return { ...env, LANG: source.LANG ?? "C.UTF-8" };
	const root = source.SystemRoot ?? source.windir ?? "C:\\Windows";
	return {
		...env,
		USERPROFILE: home,
		APPDATA: join(home, "AppData", "Roaming"),
		LOCALAPPDATA: join(home, "AppData", "Local"),
		TEMP: tmp,
		TMP: tmp,
		SystemRoot: root,
		windir: root,
		ComSpec: source.ComSpec ?? join(root, "System32", "cmd.exe"),
		PATHEXT: source.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
	};
}

/** The directories `baseEnv` points at, which have to exist before anything reads them. */
export function homeDirs(env) {
	return [
		env.HOME,
		env.TMPDIR,
		env.CLAUDE_CONFIG_DIR,
		env.CODEX_HOME,
		env.APPDATA,
		env.LOCALAPPDATA,
	].filter(Boolean);
}

/**
 * Ends a process and its children. POSIX children run in their own group; Windows has no
 * signals, so `taskkill /T` walks the tree and the signal name is dropped.
 * @param {number | undefined} pid @param {NodeJS.Signals} signal
 * @param {NodeJS.Platform} platform
 */
export function killTree(pid, signal = "SIGKILL", platform = process.platform) {
	if (!pid) return;
	if (platform === "win32") {
		spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
			stdio: "ignore",
		});
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		// already gone
	}
}
