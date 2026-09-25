// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl up`'s one-line "a newer prismalens exists" notice (#606).
 *
 * Three properties hold it to the shape the other lanes were designed against:
 *
 * 1. **It never gates boot.** The line printed this run comes from a cache file;
 *    the network call only refreshes that cache for the next run. A first run,
 *    an offline machine and a blocked proxy all print nothing and boot at the
 *    same speed.
 * 2. **It sends no identifier.** A HEAD of the public `releases/latest` redirect
 *    carries no query, no body and no id — only the IP and UA any HTTP request
 *    carries. That is why it is not part of the opt-in telemetry of #602, and
 *    why `DO_NOT_TRACK` still turns it off.
 * 3. **It belongs to the CLI channels.** The desktop app announces updates
 *    itself, so this path is off under `PRISMALENS_RUN_MODE=electron`.
 * 4. **It names only an upgrade that can install.** A release is announced once
 *    its `SHA256SUMS` is attached, which the installer channels need (#717).
 *
 * GitHub Releases rather than a registry or a project-owned manifest:
 * release-please already publishes the release, and electron-updater's GitHub
 * provider reads the same manifest, so one source serves both channels.
 */

import {
	doNotTrack,
	isNewer,
	isStale,
	readCache,
	refreshUpdateCache,
} from "@prismalens/config";

export {
	fetchLatestVersion,
	isNewer,
	isStale,
	readCache,
	releaseReady,
	type UpdateCheckCache,
	writeCache,
} from "@prismalens/config";

/** How this process was launched. An Electron shell declares itself. */
export type RunMode = "npm" | "electron";

/**
 * The launcher declares itself; nothing is inferred. An Electron shell spawns
 * this backend with `PRISMALENS_RUN_MODE=electron` and updates itself.
 */
export function runMode(env: NodeJS.ProcessEnv): RunMode {
	return env.PRISMALENS_RUN_MODE === "electron" ? "electron" : "npm";
}

/**
 * Whether this process may check at all. Off for a non-interactive stdout (a
 * pipe, a log file, a systemd unit), in CI, under `DO_NOT_TRACK`, under
 * `PRISMALENS_UPDATE_CHECK=off`, and for any launcher but npm.
 */
export function updateCheckEnabled(
	env: NodeJS.ProcessEnv,
	stdoutIsTTY: boolean,
): boolean {
	if (env.PRISMALENS_UPDATE_CHECK === "off") return false;
	if (!stdoutIsTTY) return false;
	if (env.CI !== undefined && env.CI !== "") return false;
	if (doNotTrack(env)) return false;
	return runMode(env) === "npm";
}

/** The notice line, or null when there is nothing to say. */
export function noticeFor(
	latest: string | null,
	current: string,
): string | null {
	if (!latest || !isNewer(latest, current)) return null;
	return `prismalens ${latest} is available (you have ${current}). Run: pl upgrade`;
}

export interface UpdateNotice {
	/** What to print after the ready line, or null. Read from the cache only. */
	line: string | null;
	/** Resolves once a stale cache has been refreshed. Never awaited by boot. */
	refresh: Promise<void>;
}

/**
 * Read the cache, decide the line, and refresh in the background when the cache
 * is older than 24 h. Callers print `line` and let `refresh` run unawaited.
 */
export function updateNotice(options: {
	current: string;
	workspaceDir: string;
	env?: NodeJS.ProcessEnv;
	stdoutIsTTY?: boolean;
	fetchImpl?: typeof fetch;
	now?: number;
}): UpdateNotice {
	const {
		current,
		workspaceDir,
		env = process.env,
		stdoutIsTTY = process.stdout.isTTY === true,
		fetchImpl = fetch,
		now = Date.now(),
	} = options;

	if (!updateCheckEnabled(env, stdoutIsTTY)) {
		return { line: null, refresh: Promise.resolve() };
	}

	const cache = readCache(workspaceDir);
	const line = noticeFor(cache?.latest ?? null, current);
	if (!isStale(cache, now)) return { line, refresh: Promise.resolve() };

	const refresh = refreshUpdateCache(workspaceDir, fetchImpl).catch(() => {
		// Already fail-silent one level down; this keeps the promise safe to
		// leave unawaited whatever a future fetch implementation does.
	});
	return { line, refresh };
}
