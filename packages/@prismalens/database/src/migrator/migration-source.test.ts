// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	MIGRATIONS_DIR_ENV,
	type MigrationFlavour,
	migrationDirCandidates,
	readShippedMigrations,
	resolveMigrationsDir,
} from "./migration-source.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH_ROOT = join(PACKAGE_DIR, ".tmp-migrator-tests");

let scratch: string;
let originalEnv: string | undefined;

beforeEach(() => {
	mkdirSync(SCRATCH_ROOT, { recursive: true });
	scratch = mkdtempSync(join(SCRATCH_ROOT, "source-"));
	originalEnv = process.env[MIGRATIONS_DIR_ENV];
	delete process.env[MIGRATIONS_DIR_ENV];
});

afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	if (originalEnv === undefined) delete process.env[MIGRATIONS_DIR_ENV];
	else process.env[MIGRATIONS_DIR_ENV] = originalEnv;
});

describe("resolveMigrationsDir", () => {
	it("finds the SQL that ships with the package, without a workspace root", () => {
		// The same relative walk works from src/ and from dist/src/ because
		// `rootDir: "."` makes dist mirror the package root.
		const dir = resolveMigrationsDir("sqlite");
		expect(dir).toBe(migrationDirCandidates("sqlite")[0]);
		expect(readShippedMigrations(dir).map((m) => m.name)).toContain(
			"20260803122809_init",
		);
	});

	it("finds the postgres lineage too", () => {
		expect(readShippedMigrations(resolveMigrationsDir("pg"))).not.toHaveLength(
			0,
		);
	});

	it("honours the env override", () => {
		mkdirSync(join(scratch, "20260101000000_x"), { recursive: true });
		writeFileSync(join(scratch, "20260101000000_x", "migration.sql"), "SELECT 1;");
		process.env[MIGRATIONS_DIR_ENV] = scratch;

		expect(resolveMigrationsDir("sqlite")).toBe(scratch);
	});

	it("names the configured override when it does not exist", () => {
		process.env[MIGRATIONS_DIR_ENV] = join(scratch, "nope");
		expect(() => resolveMigrationsDir("sqlite")).toThrow(/nope/);
	});

	it("names every candidate it tried when the search finds nothing", () => {
		// A lineage that does not exist, so every candidate misses and the search
		// path (not the override path) produces the message.
		const missing = "mysql" as MigrationFlavour;
		let message = "";
		try {
			resolveMigrationsDir(missing);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).not.toBe("");
		for (const candidate of migrationDirCandidates(missing)) {
			expect(message).toContain(candidate);
		}
		expect(message).toContain(MIGRATIONS_DIR_ENV);
	});
});

describe("readShippedMigrations", () => {
	it("returns migrations in timestamp order, ignoring dot-directories", () => {
		for (const name of ["20260102000000_b", "20260101000000_a", ".keep"]) {
			mkdirSync(join(scratch, name), { recursive: true });
		}
		writeFileSync(join(scratch, "20260101000000_a", "migration.sql"), "SELECT 1;");
		writeFileSync(join(scratch, "20260102000000_b", "migration.sql"), "SELECT 2;");

		expect(readShippedMigrations(scratch).map((m) => m.name)).toEqual([
			"20260101000000_a",
			"20260102000000_b",
		]);
	});

	it("throws on a migration directory with no SQL rather than under-migrating", () => {
		mkdirSync(join(scratch, "20260101000000_a"), { recursive: true });
		writeFileSync(join(scratch, "20260101000000_a", "migration.sql"), "SELECT 1;");
		mkdirSync(join(scratch, "20260103000000_empty"), { recursive: true });

		expect(() => readShippedMigrations(scratch)).toThrow(
			/20260103000000_empty.*missing migration\.sql/,
		);
	});

	it("checksums the raw bytes with sha256, matching Prisma", () => {
		mkdirSync(join(scratch, "20260101000000_a"), { recursive: true });
		writeFileSync(join(scratch, "20260101000000_a", "migration.sql"), "SELECT 1;");

		// sha256("SELECT 1;")
		expect(readShippedMigrations(scratch)[0].checksum).toBe(
			"17db4fd369edb9244b9f91d9aeed145c3d04ad8ba6e95d06247f07a63527d11a",
		);
	});
});
