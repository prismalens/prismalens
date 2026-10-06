// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { ensureAppDataDir, getConfig } from "@prismalens/config";
import { PrismaClient } from "./prisma/generated/client.js";
import { libsqlFileUrl } from "./src/libsql-url.js";

const config = getConfig();

// Create application data directory if it doesn't exist
// This stores the SQLite database file and other application data
ensureAppDataDir();

const dbPath = config.PRISMALENS_DB_URL.replace(/^file:/, "");
if (config.PRISMALENS_DB_SQLITE_FILE_MUST_EXIST && !existsSync(dbPath)) {
	throw new Error(`SQLite database file does not exist: ${dbPath}`);
}

// libsql ships prebuilt per-platform packages and runs no install script, so
// `npm i -g` works where scripts are off by default (npm 12, issue n1).
const adapter = new PrismaLibSql({
	url: libsqlFileUrl(dbPath),
	timeout: config.PRISMALENS_DB_SQLITE_TIMEOUT,
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
	globalForPrisma.prisma ||
	new PrismaClient({
		adapter,
	});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
