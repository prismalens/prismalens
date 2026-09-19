// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The installed `prismalens` package's version: `pl up` wraps this API in its
 * own published tarball, so that is the version a user actually has, not
 * `@prismalens/api`'s workspace version. Walks up from this file (deep under
 * `node_modules/@prismalens/api/dist/...` in the packed tarball) until it finds
 * that package.json, falling back to the nearest package.json on the way (the
 * workspace package in a dev checkout). #337 run e saw the log carry a
 * hardcoded "0.1.0" beside a 0.5.0-rc.3 CLI.
 */
export function resolveServiceVersion(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	let fallback: string | undefined;
	for (let i = 0; i < 10; i++) {
		try {
			const pkg = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as { name?: string; version?: string };
			if (pkg.name === "prismalens" && pkg.version) return pkg.version;
			if (!fallback && pkg.version) fallback = pkg.version;
		} catch {
			// not here, keep walking up
		}
		dir = dirname(dir);
	}
	return fallback ?? "0.0.0";
}
