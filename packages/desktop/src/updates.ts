// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop app's "a newer PrismaLens is out" check (#717). Same source and
 * privacy as `pl up`'s notice: a HEAD of the public releases redirect, no id.
 * Auto-update waits for signed builds (#697); until then this links the download.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const RELEASES = "https://github.com/prismalens/prismalens/releases";
const TIMEOUT_MS = 5_000;

type Version = [number, number, number];

function parse(v: string): Version | null {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string): boolean {
	const a = parse(latest);
	const b = parse(current);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/** Off under `PRISMALENS_UPDATE_CHECK=off` or a truthy `DO_NOT_TRACK`, as in the CLI. */
export function updateCheckEnabled(env: NodeJS.ProcessEnv): boolean {
	if (env.PRISMALENS_UPDATE_CHECK === "off") return false;
	const dnt = env.DO_NOT_TRACK?.trim().toLowerCase();
	return dnt === undefined || dnt === "" || ["0", "false", "off"].includes(dnt);
}

/** The version of the packed backend the app runs, from its package.json. */
export function backendVersion(backendMain: string): string | null {
	try {
		const pkg = JSON.parse(
			readFileSync(
				join(dirname(dirname(dirname(backendMain))), "package.json"),
				"utf8",
			),
		) as { version?: string };
		return pkg.version ?? null;
	} catch {
		return null;
	}
}

export function releaseUrl(version: string): string {
	return `${RELEASES}/tag/v${version}`;
}

/**
 * The newer release to announce, or null. Only once its downloads are attached
 * (`SHA256SUMS`, written ~20 min after the publish), so the link never 404s.
 */
export async function availableUpdate(
	current: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	try {
		const head = (url: string) =>
			fetchImpl(url, {
				method: "HEAD",
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		const latestRes = await head(`${RELEASES}/latest`);
		const tag = /\/releases\/tag\/(.+)$/.exec(
			latestRes.headers.get("location") ?? "",
		)?.[1];
		const latest = tag ? decodeURIComponent(tag).replace(/^v/, "") : null;
		if (!latest || !isNewer(latest, current)) return null;
		const sums = await head(`${RELEASES}/download/v${latest}/SHA256SUMS`);
		return sums.status >= 200 && sums.status < 400 ? latest : null;
	} catch {
		return null;
	}
}
