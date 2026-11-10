// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Get the application data directory for Prismalens.
 *
 * Respects the PRISMALENS_WORKSPACE_DIR environment variable if set.
 * Defaults to ~/.prismalens if not specified.
 *
 * The directory structure includes:
 * - prismalens.db: SQLite database file
 * - encryption-key: (future) encryption key for sensitive data
 * - logs/: (future) application logs
 * - config/: (future) configuration files
 *
 * @returns Absolute path to the Prismalens application data directory
 * @example
 * // Returns: /home/username/.prismalens
 * const appDataDir = getAppDataDir();
 *
 * // Or with custom PRISMALENS_WORKSPACE_DIR env var:
 * // PRISMALENS_WORKSPACE_DIR=/var/prismalens -> /var/prismalens
 * const appDataDir = getAppDataDir();
 */
export function getAppDataDir(): string {
	if (process.env.PRISMALENS_WORKSPACE_DIR) {
		return process.env.PRISMALENS_WORKSPACE_DIR;
	}
	return join(homedir(), ".prismalens");
}

/**
 * Ensure the workspace exists and only its owner can read it (0700). It holds
 * the database, the encryption key and attachments. An existing workspace is
 * tightened on the first call in each process, so an upgrade fixes an older
 * 0755 one; a workspace this user cannot chmod (a mounted volume) is left as is.
 */
const tightened = new Set<string>();
export function ensureAppDataDir(): string {
	const appDataDir = getAppDataDir();
	mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
	if (!tightened.has(appDataDir)) {
		tightened.add(appDataDir);
		try {
			chmodSync(appDataDir, 0o700);
		} catch {}
	}
	return appDataDir;
}
