// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The Node releases `pl doctor` and About's diagnostics accept (#998). */

// engines.node >=24 (scripts/pack-cli.mjs) is a major floor; these are the patched releases
// of each supported line (CVE-2026-111497, #998). Raise a line's floor on the next advisory.
export const NODE_PATCH_FLOORS: Record<number, string> = {
	24: "24.22.1",
	26: "26.12.1",
};

const parts = (v: string) => v.split(".").map(Number);

/** Why this Node is refused, or null when it is a patched release of a supported line. */
export function nodeVersionProblem(version: string): string | null {
	const [major, minor, patch] = parts(version);
	const lines = Object.keys(NODE_PATCH_FLOORS).map(Number);
	if (major < Math.min(...lines))
		return `prismalens requires Node >= ${Math.min(...lines)}`;
	const floor = NODE_PATCH_FLOORS[major];
	if (!floor) {
		return major > Math.max(...lines)
			? null
			: `Node ${major} is not a supported line; use ${Object.values(NODE_PATCH_FLOORS).join(" or ")} or later`;
	}
	const [, fMinor, fPatch] = parts(floor);
	const ok = minor > fMinor || (minor === fMinor && patch >= fPatch);
	return ok
		? null
		: `Node ${version} lacks a security fix; upgrade to ${floor} or later`;
}
