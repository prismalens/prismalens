// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
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
 * Ensure the application data directory exists.
 *
 * Creates the directory and all parent directories if they don't exist.
 * Sets directory permissions to 0o755 (owner: rwx, group: rx, other: rx)
 * for proper discoverability and access.
 *
 * @returns Absolute path to the created application data directory
 * @throws Error if directory creation fails (permission denied, etc.)
 * @example
 * const appDataDir = ensureAppDataDir();
 * // Directory created at ~/.prismalens with rwxr-xr-x permissions
 */
export function ensureAppDataDir(): string {
	const appDataDir = getAppDataDir();
	mkdirSync(appDataDir, { recursive: true, mode: 0o755 });
	return appDataDir;
}
