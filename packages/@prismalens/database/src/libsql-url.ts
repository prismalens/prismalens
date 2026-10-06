// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `file:` URL for a local path, as @libsql/client parses it: it URI-decodes the
 * path and splits on `?`/`#`, so those three characters are escaped. Windows
 * drive paths (`C:\…`) pass through unchanged.
 */
export function libsqlFileUrl(path: string): string {
	return `file:${path.replace(/[%?#]/g, (c) => encodeURIComponent(c))}`;
}
