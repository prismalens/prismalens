// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * The script of a shipped adapter's bin, or null when this install has none.
 * `scripts/pack-cli.mjs` installs the pins without optional dependencies, so
 * the adapters run the user's own `claude` / `codex`, never a bundled one (#818).
 */
export function shippedAdapter(pkg: string): string | null {
	try {
		const manifestPath = require.resolve(`${pkg}/package.json`);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			bin?: string | Record<string, string>;
		};
		const bin =
			typeof manifest.bin === "string"
				? manifest.bin
				: Object.values(manifest.bin ?? {})[0];
		return bin ? join(dirname(manifestPath), bin) : null;
	} catch {
		return null;
	}
}

/** The version this install ships of `pkg`, or null. */
export function shippedVersion(pkg: string): string | null {
	try {
		const manifestPath = require.resolve(`${pkg}/package.json`);
		return (
			(JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string })
				.version ?? null
		);
	} catch {
		return null;
	}
}
