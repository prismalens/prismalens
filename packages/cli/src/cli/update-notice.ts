// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl up`'s one-line "newer version on npm" notice (#606). Never blocks boot and
 * never throws: an offline machine, a slow registry or a proxy just prints nothing.
 * `PRISMALENS_UPDATE_CHECK=off` skips the request entirely.
 */

const REGISTRY_URL = "https://registry.npmjs.org/prismalens/latest";
const TIMEOUT_MS = 3_000;

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

export function updateCheckEnabled(env: NodeJS.ProcessEnv): boolean {
	return env.PRISMALENS_UPDATE_CHECK !== "off";
}

/** The notice line, or null when there is nothing to say. */
export async function checkForUpdate(
	current: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	try {
		const res = await fetchImpl(REGISTRY_URL, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: "application/json" },
		});
		if (!res.ok) return null;
		const { version } = (await res.json()) as { version?: unknown };
		if (typeof version !== "string" || !isNewer(version, current)) return null;
		return `prismalens ${version} is available (you have ${current}): npm install -g prismalens@latest`;
	} catch {
		return null;
	}
}
