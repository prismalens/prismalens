// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ServicePackage {
	name?: string;
	version?: string;
	build?: string;
}

function findServicePackage(fromDir?: string): ServicePackage | null {
	let dir = fromDir ?? dirname(fileURLToPath(import.meta.url));
	let fallback: ServicePackage | undefined;
	for (let i = 0; i < 10; i++) {
		try {
			const pkg = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as ServicePackage;
			if (pkg.name === "prismalens") return pkg;
			if (!fallback && pkg.version) fallback = pkg;
		} catch {
			// not here, keep walking up
		}
		dir = dirname(dir);
	}
	return fallback ?? null;
}

/**
 * The installed `prismalens` package's version: `pl up` wraps this API in its
 * own published tarball, so that is the version a user actually has, not
 * `@prismalens/api`'s workspace version. Walks up from this file (deep under
 * `node_modules/@prismalens/api/dist/...` in the packed tarball) until it finds
 * that package.json, falling back to the nearest package.json on the way (the
 * workspace package in a dev checkout). #337 run e saw the log carry a
 * hardcoded "0.1.0" beside a 0.5.0-rc.3 CLI.
 */
export function resolveServiceVersion(fromDir?: string): string {
	return findServicePackage(fromDir)?.version ?? "0.0.0";
}

/** The short commit sha stamped at pack time, or null when absent (e.g. dev). */
export function resolveServiceBuild(fromDir?: string): string | null {
	const pkg = findServicePackage(fromDir);
	return typeof pkg?.build === "string" ? pkg.build : null;
}
