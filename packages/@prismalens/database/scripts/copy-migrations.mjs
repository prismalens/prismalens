// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Build step: copy the migration SQL into `dist/` so it ships inside the
 * package.
 *
 * `tsc` emits only JavaScript. Without this, a packed install has the runner
 * but not the SQL it applies — and `pl up` has no `prisma` CLI or schema source
 * to fall back on. `rootDir: "."` makes `dist/` mirror the package root, so the
 * runner resolves `../../prisma/<flavour>/schema` identically from source and
 * from `dist/src/migrator/`.
 *
 * Both lineages are copied; the runner picks one at runtime by database type,
 * so the build product must not be flavour-specific.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flavours = ["sqlite", "pg"];

let copied = 0;
for (const flavour of flavours) {
	const from = join(packageDir, "prisma", flavour, "schema");
	const to = join(packageDir, "dist", "prisma", flavour, "schema");
	if (!existsSync(from)) {
		throw new Error(
			`Expected migrations at ${from}, but the directory is missing.`,
		);
	}
	mkdirSync(to, { recursive: true });
	cpSync(from, to, {
		recursive: true,
		// Schema sources stay out of dist — only what the runner reads at
		// runtime: the migration SQL and the provider lock file.
		filter: (src) => !src.endsWith(".prisma"),
	});
	copied++;
}

console.log(
	`copy-migrations: staged ${copied} migration lineage(s) into dist/prisma`,
);
