// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { ensureAppDataDir, getConfig } from "@prismalens/config";
import { PrismaClient } from "./prisma/generated/client.js";

const config = getConfig();

// Create application data directory if it doesn't exist
// This stores the SQLite database file and other application data
ensureAppDataDir();

const adapter = new PrismaBetterSqlite3({
	url: config.PRISMALENS_DB_URL,
	readonly: config.PRISMALENS_DB_SQLITE_READONLY,
	fileMustExist: config.PRISMALENS_DB_SQLITE_FILE_MUST_EXIST,
	timeout: config.PRISMALENS_DB_SQLITE_TIMEOUT,
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
	globalForPrisma.prisma ||
	new PrismaClient({
		adapter,
	});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
