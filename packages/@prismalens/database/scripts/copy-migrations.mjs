// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Build step: copy the SQLite migration SQL into `dist/` so a packed install
// has it (no `prisma` CLI on an end user's machine). See #597.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const from = join(packageDir, "prisma", "sqlite", "schema");
const to = join(packageDir, "dist", "prisma", "sqlite", "schema");
if (!existsSync(from)) {
	throw new Error(
		`Expected migrations at ${from}, but the directory is missing.`,
	);
}
// Wipe the destination first. `cpSync` merges, so an incremental build after
// switching branches would leave a migration in `dist` that no longer exists
// in source — and the runner would try to apply it.
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, {
	recursive: true,
	// Schema sources stay out of dist — only what the runner reads at
	// runtime: the migration SQL and the provider lock file.
	filter: (src) => !src.endsWith(".prisma"),
});

console.log(
	"copy-migrations: staged the sqlite migration lineage into dist/prisma",
);
