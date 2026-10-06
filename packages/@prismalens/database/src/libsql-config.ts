// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Config } from "@libsql/client";

/**
 * `file:` URL for a local path, as @libsql/client parses it: it URI-decodes the
 * path and splits on `?`/`#`, so those three characters are escaped. Windows
 * drive and UNC paths pass through unchanged.
 */
export function libsqlFileUrl(path: string): string {
	return `file:${path.replace(/[%?#]/g, (c) => encodeURIComponent(c))}`;
}

export interface LibsqlOptions {
	readonly: boolean;
	timeout: number;
}

/** Adapter config for the app database; `timeout` is SQLite's busy timeout in ms. */
export function libsqlConfig(path: string, options: LibsqlOptions): Config {
	// @libsql/client rejects SQLite's `?mode=ro` and has no read-only flag, so a
	// read-only open is impossible here; refuse instead of silently writing (n1).
	if (options.readonly) {
		throw new Error(
			"PRISMALENS_DB_SQLITE_READONLY=true is not supported: the SQLite driver (libsql) " +
				"cannot open the database read-only. Unset it to start PrismaLens.",
		);
	}
	return { url: libsqlFileUrl(path), timeout: options.timeout };
}
