// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Build the SQLite connection URL from configuration.
 * Database path is stored in the app data directory (~/.prismalens by default).
 * Can be customized via PRISMALENS_WORKSPACE_DIR environment variable.
 */

import { join } from "node:path";
import type { DatabaseConfig } from "../env/database.js";
import { getAppDataDir } from "./app-data.js";

export function buildDatabaseUrl(_config: DatabaseConfig): string {
	const appDataDir = getAppDataDir();
	const dbPath = join(appDataDir, "prismalens.db");
	return `file:${dbPath}`;
}
