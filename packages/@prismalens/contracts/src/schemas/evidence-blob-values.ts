// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/**
 * A path from the repository's top: forward slashes, no `.`/`..`/empty
 * segment, nothing absolute, no control character. Git resolves it inside
 * the commit's tree, so this is the first of two fences, not the only one.
 */
export function isSafeRepoPath(path: string): boolean {
	if (path.length === 0 || path.length > 1024) return false;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses.
	if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
	if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
	return path
		.split("/")
		.every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
