// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Bundled = Record<string, { version: string; script: string }>;

const MANIFEST = new URL("./adapters/bundled.json", import.meta.url);

function bundled(pkg: string): { version: string; script: string } | null {
	try {
		const all = JSON.parse(readFileSync(MANIFEST, "utf8")) as Bundled;
		return Object.hasOwn(all, pkg) ? all[pkg] : null;
	} catch {
		return null;
	}
}

/**
 * The single-file script of a shipped adapter, or null when this install has none.
 * `scripts/bundle.mjs` writes it; the adapters run the user's own `claude` / `codex`,
 * never a bundled one (#818, #906).
 */
export function shippedAdapter(pkg: string): string | null {
	const entry = bundled(pkg);
	if (!entry) return null;
	const script = fileURLToPath(new URL(entry.script, MANIFEST));
	return existsSync(script) ? script : null;
}

/** The version this install ships of `pkg`, or null. */
export function shippedVersion(pkg: string): string | null {
	return bundled(pkg)?.version ?? null;
}
