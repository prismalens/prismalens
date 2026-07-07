// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package version, read from package.json at runtime so the number lives
 * in exactly one place (bumped by changesets). Walks up from this file until
 * the CLI's own package.json is found — the depth differs between dev
 * (src/version.ts via tsx) and the build (dist/src/version.js).
 */
export function cliVersion(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 4; i++) {
		try {
			const pkg = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as { name?: string; version?: string };
			if (pkg.name === "prismalens" && pkg.version) return pkg.version;
		} catch {
			// not here — keep walking up
		}
		dir = dirname(dir);
	}
	return "0.0.0";
}
