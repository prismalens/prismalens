// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The update check shared by `pl up`'s notice and Settings → About (#606, #717):
 * a HEAD of the public GitHub releases redirect, no id, cached for a day in the
 * workspace. A release counts once its `SHA256SUMS` is attached.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RELEASES_LATEST_URL =
	"https://github.com/prismalens/prismalens/releases/latest";
const RELEASES_DOWNLOAD_URL =
	"https://github.com/prismalens/prismalens/releases/download";
export const RELEASES_URL = "https://github.com/prismalens/prismalens/releases";
const TIMEOUT_MS = 3_000;
const CACHE_FILE = "update-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** `{checkedAt, latest}` — the whole of what is kept on disk. */
export interface UpdateCheckCache {
	/** Epoch millis of the last completed check, successful or not. */
	checkedAt: number;
	/** Latest plain `x.y.z` seen, or null when the last check could not tell. */
	latest: string | null;
	/** Ask again at this epoch millis instead of a day after `checkedAt`. */
	recheckAt?: number;
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

/** `DO_NOT_TRACK` counts as set for anything but empty, `0`, `false`, `off`. */
export function doNotTrack(env: NodeJS.ProcessEnv): boolean {
	const value = env.DO_NOT_TRACK?.trim().toLowerCase();
	return (
		value !== undefined &&
		value !== "" &&
		!["0", "false", "off"].includes(value)
	);
}

/** Which switch turned the check off, or null when it may run. */
export function updateCheckDisabledBy(
	env: NodeJS.ProcessEnv,
): "PRISMALENS_UPDATE_CHECK" | "DO_NOT_TRACK" | null {
	if (env.PRISMALENS_UPDATE_CHECK === "off") return "PRISMALENS_UPDATE_CHECK";
	if (doNotTrack(env)) return "DO_NOT_TRACK";
	return null;
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
		const { checkedAt, latest, recheckAt } = raw as Record<string, unknown>;
		if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) {
			return null;
		}
		if (latest !== null && typeof latest !== "string") return null;
		if (typeof recheckAt === "number" && Number.isFinite(recheckAt)) {
			return { checkedAt, latest, recheckAt };
		}
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
	if (cache === null) return true;
	if (cache.recheckAt !== undefined) return now >= cache.recheckAt;
	return now - cache.checkedAt >= CACHE_TTL_MS;
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

/** How soon to ask again when the newest release's downloads aren't attached yet. */
const NOT_READY_RETRY_MS = 60 * 60 * 1000;

/**
 * Refresh the day-long cache. A release whose `SHA256SUMS` isn't attached yet is
 * not learned; the previous answer is kept and the check comes back in an hour,
 * so a release whose archive build failed doesn't make every run ask again.
 */
export async function refreshUpdateCache(
	workspaceDir: string,
	fetchImpl: typeof fetch = fetch,
	now: number = Date.now(),
): Promise<void> {
	const latest = await fetchLatestVersion(fetchImpl);
	if (latest && !(await releaseReady(latest, fetchImpl))) {
		writeCache(workspaceDir, {
			checkedAt: now,
			latest: readCache(workspaceDir)?.latest ?? null,
			recheckAt: now + NOT_READY_RETRY_MS,
		});
		return;
	}
	writeCache(workspaceDir, { checkedAt: now, latest });
}
