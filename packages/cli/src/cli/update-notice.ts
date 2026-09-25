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

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RELEASES_LATEST_URL =
	"https://github.com/prismalens/prismalens/releases/latest";
const RELEASES_DOWNLOAD_URL =
	"https://github.com/prismalens/prismalens/releases/download";
const TIMEOUT_MS = 3_000;
const CACHE_FILE = "update-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** How this process was launched. An Electron shell declares itself. */
export type RunMode = "npm" | "electron";

/** `{checkedAt, latest}` — the whole of what is kept on disk. */
export interface UpdateCheckCache {
	/** Epoch millis of the last completed check, successful or not. */
	checkedAt: number;
	/** Latest plain `x.y.z` seen, or null when the last check could not tell. */
	latest: string | null;
}

type Version = [number, number, number];

function parse(version: string): Version | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True only for two plain `x.y.z` versions where `latest` is higher. */
export function isNewer(latest: string, current: string): boolean {
	const a = parse(latest);
	const b = parse(current);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] > b[i];
	}
	return false;
}

/**
 * The launcher declares itself; nothing is inferred. An Electron shell spawns
 * this backend with `PRISMALENS_RUN_MODE=electron` and updates itself.
 */
export function runMode(env: NodeJS.ProcessEnv): RunMode {
	return env.PRISMALENS_RUN_MODE === "electron" ? "electron" : "npm";
}

/** `DO_NOT_TRACK` counts as set for anything but empty, `0`, `false`, `off`. */
function doNotTrack(env: NodeJS.ProcessEnv): boolean {
	const value = env.DO_NOT_TRACK?.trim().toLowerCase();
	return (
		value !== undefined &&
		value !== "" &&
		!["0", "false", "off"].includes(value)
	);
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

function cachePath(workspaceDir: string): string {
	return join(workspaceDir, CACHE_FILE);
}

/** The cache, or null when it is absent, unreadable or not the shape above. */
export function readCache(workspaceDir: string): UpdateCheckCache | null {
	try {
		const raw: unknown = JSON.parse(
			readFileSync(cachePath(workspaceDir), "utf8"),
		);
		if (typeof raw !== "object" || raw === null) return null;
		const { checkedAt, latest } = raw as Record<string, unknown>;
		if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) {
			return null;
		}
		if (latest !== null && typeof latest !== "string") return null;
		return { checkedAt, latest };
	} catch {
		return null;
	}
}

/** Best effort: a read-only or full disk must not affect the run. */
export function writeCache(
	workspaceDir: string,
	cache: UpdateCheckCache,
): void {
	try {
		writeFileSync(cachePath(workspaceDir), `${JSON.stringify(cache)}\n`, {
			mode: 0o600,
		});
	} catch {
		// Nothing to do and nothing worth saying: the next run checks again.
	}
}

export function isStale(cache: UpdateCheckCache | null, now: number): boolean {
	return cache === null || now - cache.checkedAt >= CACHE_TTL_MS;
}

/**
 * HEAD the `releases/latest` redirect and read the tag out of `Location`.
 * `redirect: "manual"` keeps it to one request and no page body; the API is
 * never called, so there is no rate limit and no token. Null on anything
 * unexpected — the caller treats that as "nothing to say".
 */
export async function fetchLatestVersion(
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	try {
		const res = await fetchImpl(RELEASES_LATEST_URL, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const location = res.headers.get("location");
		if (!location) return null;
		const tag = /\/releases\/tag\/(.+)$/.exec(location)?.[1];
		if (!tag) return null;
		const version = decodeURIComponent(tag).replace(/^v/, "");
		return parse(version) ? version : null;
	} catch {
		return null;
	}
}

/**
 * True once `v<version>`'s `SHA256SUMS` is attached, which standalone.yml does
 * about 20 minutes after the release publishes. A 302 means the asset exists.
 */
export async function releaseReady(
	version: string,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	try {
		const res = await fetchImpl(
			`${RELEASES_DOWNLOAD_URL}/v${encodeURIComponent(version)}/SHA256SUMS`,
			{
				method: "HEAD",
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
			},
		);
		return res.status >= 200 && res.status < 400;
	} catch {
		return false;
	}
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

	const refresh = fetchLatestVersion(fetchImpl)
		.then(async (latest) => {
			// Not attached yet: leave the cache stale so the next run asks again.
			if (latest && !(await releaseReady(latest, fetchImpl))) return;
			writeCache(workspaceDir, { checkedAt: Date.now(), latest });
		})
		.catch(() => {
			// Already fail-silent one level down; this keeps the promise safe to
			// leave unawaited whatever a future fetch implementation does.
		});
	return { line, refresh };
}
