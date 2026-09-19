// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	findCredentialAccounts,
	generatePassword,
	setPassword,
} from "./reset-password.js";

function fixture(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec(`
		CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL, "createdAt" DATETIME);
		CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "providerId" TEXT NOT NULL, "password" TEXT);
		CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL);
		INSERT INTO "user" VALUES ('u1', 'owner@example.test', 1), ('u2', 'other@example.test', 2);
		INSERT INTO "account" VALUES ('a1', 'u1', 'credential', 'old'), ('a2', 'u2', 'github', NULL);
		INSERT INTO "session" VALUES ('s1', 'u1'), ('s2', 'u1'), ('s3', 'u2');
	`);
	return db;
}

describe("reset-password (#605 edge 8)", () => {
	it("finds only credential accounts, optionally by email", () => {
		const db = fixture();
		expect(findCredentialAccounts(db)).toEqual([
			{ accountId: "a1", userId: "u1", email: "owner@example.test" },
		]);
		expect(findCredentialAccounts(db, "OWNER@example.test")).toHaveLength(1);
		expect(findCredentialAccounts(db, "other@example.test")).toHaveLength(0);
	});

	it("writes the hash and signs out only that user's sessions", () => {
		const db = fixture();
		const [owner] = findCredentialAccounts(db);
		expect(setPassword(db, owner, "new-hash")).toBe(2);
		expect(
			db.prepare(`SELECT "password" FROM "account" WHERE "id" = 'a1'`).get(),
		).toEqual({ password: "new-hash" });
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM "session"`).get(),
		).toEqual({ n: 1 });
	});

	it("generates a 20-character url-safe password", () => {
		const password = generatePassword();
		expect(password).toMatch(/^[A-Za-z0-9_-]{20}$/);
		expect(generatePassword()).not.toBe(password);
	});
});
