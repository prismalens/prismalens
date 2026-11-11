// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The update check shared by `pl up`'s notice and Settings → About (#606, #717):
 * a HEAD of the public GitHub releases redirect, no id, cached for a day in the
 * workspace. A release counts once its `SHA256SUMS` is attached. The nightly
 * channel reads npm's dist-tags instead (#1024): nightlies ship on npm only.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import type { UpdateChannel } from "./update-channel.js";

const RELEASES_LATEST_URL =
	"https://github.com/prismalens/prismalens/releases/latest";
const RELEASES_DOWNLOAD_URL =
	"https://github.com/prismalens/prismalens/releases/download";
export const RELEASES_URL = "https://github.com/prismalens/prismalens/releases";
const NPM_DIST_TAGS_URL =
	"https://registry.npmjs.org/-/package/prismalens/dist-tags";
const TIMEOUT_MS = 3_000;
const CACHE_FILE = "update-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** `{checkedAt, latest, channel}` — the whole of what is kept on disk. */
export interface UpdateCheckCache {
	/** Epoch millis of the last completed check, successful or not. */
	checkedAt: number;
	/** Newest version seen on `channel`, or null when the last check could not tell. */
	latest: string | null;
	/** Ask again at this epoch millis instead of a day after `checkedAt`. */
	recheckAt?: number;
	/** The channel `latest` was read for; a cache written before channels is stable. */
	channel?: UpdateChannel;
}

/** True only for two valid semver versions where `latest` is higher; a prerelease sorts below its release. */
export function isNewer(latest: string, current: string): boolean {
	const a = semver.valid(latest.trim());
	const b = semver.valid(current.trim());
	return a !== null && b !== null && semver.gt(a, b);
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

/**
 * The cache, or null when it is absent, unreadable, not the shape above, or
 * written for another channel: a stable reader never sees a nightly answer.
 */
export function readCache(
	workspaceDir: string,
	channel: UpdateChannel = "stable",
): UpdateCheckCache | null {
	try {
		const raw: unknown = JSON.parse(
			readFileSync(cachePath(workspaceDir), "utf8"),
		);
		if (typeof raw !== "object" || raw === null) return null;
		const fields = raw as Record<string, unknown>;
		const { checkedAt, latest, recheckAt } = fields;
		if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) {
			return null;
		}
		if (latest !== null && typeof latest !== "string") return null;
		if ((fields.channel ?? "stable") !== channel) return null;
		const cache: UpdateCheckCache = { checkedAt, latest };
		if (fields.channel !== undefined) cache.channel = channel;
		if (typeof recheckAt === "number" && Number.isFinite(recheckAt)) {
			cache.recheckAt = recheckAt;
		}
		return cache;
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
 * The newest version on `channel`, or null on anything unexpected — the caller
 * treats that as "nothing to say". Stable HEADs the `releases/latest` redirect
 * and reads the tag out of `Location`: one request, no body, no rate limit.
 */
export async function fetchLatestVersion(
	fetchImpl: typeof fetch = fetch,
	channel: UpdateChannel = "stable",
): Promise<string | null> {
	if (channel === "nightly") return fetchNightlyVersion(fetchImpl);
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
		return semver.valid(version) && !semver.prerelease(version)
			? version
			: null;
	} catch {
		return null;
	}
}

/**
 * The higher of npm's `nightly` and `latest` dist-tags, so a nightly install
 * moves to a stable release once one overtakes it. One GET, no id, no token.
 */
async function fetchNightlyVersion(
	fetchImpl: typeof fetch,
): Promise<string | null> {
	try {
		const res = await fetchImpl(NPM_DIST_TAGS_URL, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) return null;
		const tags = (await res.json()) as Record<string, unknown>;
		const candidates = [tags.nightly, tags.latest].filter(
			(v): v is string => typeof v === "string" && semver.valid(v) !== null,
		);
		return candidates.sort(semver.rcompare)[0] ?? null;
	} catch {
		return null;
	}
}

/**
 * True once `v<version>`'s `SHA256SUMS` is attached, which build-standalone-cli.yml does
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
 * Refresh the day-long cache. A stable release whose `SHA256SUMS` isn't attached
 * yet is not learned; the previous answer is kept and the check comes back in an
 * hour, so a release whose archive build failed doesn't make every run ask again.
 * Nightly is npm-only, and npm has a version once its dist-tag points at it.
 */
export async function refreshUpdateCache(
	workspaceDir: string,
	fetchImpl: typeof fetch = fetch,
	now: number = Date.now(),
	channel: UpdateChannel = "stable",
): Promise<void> {
	const latest = await fetchLatestVersion(fetchImpl, channel);
	if (
		channel === "stable" &&
		latest &&
		!(await releaseReady(latest, fetchImpl))
	) {
		writeCache(workspaceDir, {
			checkedAt: now,
			latest: readCache(workspaceDir, channel)?.latest ?? null,
			recheckAt: now + NOT_READY_RETRY_MS,
			channel,
		});
		return;
	}
	writeCache(workspaceDir, { checkedAt: now, latest, channel });
}

/** True for a full semver version written exactly as semver prints it (`0.5.4-nightly.20261111.1`). */
export function isExactVersion(version: string): boolean {
	return semver.valid(version) === version;
}
