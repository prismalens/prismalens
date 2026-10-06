// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { ensureAppDataDir, getConfig } from "@prismalens/config";
import { PrismaClient } from "./prisma/generated/client.js";
import { PrismaNodeSqlite } from "./src/adapter-node-sqlite/index.js";

const config = getConfig();

// Create application data directory if it doesn't exist
// This stores the SQLite database file and other application data
ensureAppDataDir();

const dbPath = config.PRISMALENS_DB_URL.replace(/^file:/, "");
if (config.PRISMALENS_DB_SQLITE_FILE_MUST_EXIST && !existsSync(dbPath)) {
	throw new Error(`SQLite database file does not exist: ${dbPath}`);
}

// Node's built-in SQLite: no native addon, so `npm i -g` needs no install
// script (npm 12 skips them by default, issue n1).
const adapter = new PrismaNodeSqlite({
	url: dbPath,
	readOnly: config.PRISMALENS_DB_SQLITE_READONLY,
	timeout: config.PRISMALENS_DB_SQLITE_TIMEOUT,
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
	globalForPrisma.prisma ||
	new PrismaClient({
		adapter,
	});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
