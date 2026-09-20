// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The point of these tests is the round trip, not the hash format.
 *
 * The previous version of this command reimplemented better-auth's scrypt
 * parameters and pinned them with a golden vector — a test that can only fail
 * *after* an upgrade has already shipped a hash sign-in cannot verify. What
 * matters is one question: after `pl reset-password`, does the printed password
 * sign in and the old one stop working? So these drive a real `betterAuth()`
 * instance through sign-up, reset and sign-in. The storage is the in-memory
 * adapter; the hashing, the update and the verification are the same code the
 * running app uses, so a change to better-auth's format breaks this test rather
 * than a user's login.
 */

import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vitest";
import { oneAccountOnly } from "./auth.js";
import {
	generatePassword,
	type OwnerAccountStore,
	ResetOwnerPasswordError,
	resetOwnerPasswordWith,
} from "./reset-password.js";

type Row = Record<string, unknown>;

function harness() {
	const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
	const auth = betterAuth({
		database: memoryAdapter(db),
		baseURL: "http://localhost:3000",
		secret: "test-secret-1234567890-test-secret-1234567890",
		emailAndPassword: { enabled: true, requireEmailVerification: false },
		plugins: [oneAccountOnly()],
	});

	const store: OwnerAccountStore = {
		listCredentialAccounts: async () =>
			(db.account as Row[])
				.filter((a) => a.providerId === "credential")
				.map((a) => ({
					id: String(a.id),
					userId: String(a.userId),
					email: String(
						(db.user as Row[]).find((u) => u.id === a.userId)?.email,
					),
				})),
		readPassword: async (accountId) => {
			const row = (db.account as Row[]).find((a) => a.id === accountId);
			return row?.password == null ? null : String(row.password);
		},
		deleteSessions: async (userId) => {
			const before = (db.session as Row[]).length;
			db.session = (db.session as Row[]).filter((s) => s.userId !== userId);
			return before - (db.session as Row[]).length;
		},
	};

	const signIn = (email: string, password: string) =>
		auth.api.signInEmail({ body: { email, password }, asResponse: true });

	return { auth, db, store, signIn };
}

const OWNER = "owner@example.test";
const OLD_PASSWORD = "correct horse battery staple";

async function withOwner() {
	const h = harness();
	await h.auth.api.signUpEmail({
		body: { email: OWNER, password: OLD_PASSWORD, name: "Owner" },
	});
	return h;
}

describe("resetOwnerPassword (#605 edge 8)", () => {
	it("the printed password signs in, and the old one stops working", async () => {
		const h = await withOwner();
		expect((await h.signIn(OWNER, OLD_PASSWORD)).status).toBe(200);

		const reset = await resetOwnerPasswordWith(h.auth, h.store);

		expect(reset.email).toBe(OWNER);
		expect((await h.signIn(OWNER, reset.password)).status).toBe(200);
		expect((await h.signIn(OWNER, OLD_PASSWORD)).status).not.toBe(200);
	});

	it("writes a hash better-auth made, not one this package invented", async () => {
		const h = await withOwner();
		const [account] = await h.store.listCredentialAccounts();
		const before = await h.store.readPassword(account.id);

		const reset = await resetOwnerPasswordWith(h.auth, h.store);
		const after = await h.store.readPassword(account.id);

		expect(after).not.toBe(before);
		// The same primitive the sign-in path uses, on the stored value.
		const ctx = await h.auth.$context;
		expect(
			await ctx.password.verify({
				password: reset.password,
				hash: after as string,
			}),
		).toBe(true);
	});

	it("signs every session of that user out, and nobody else's", async () => {
		const h = await withOwner();
		await h.signIn(OWNER, OLD_PASSWORD);
		await h.signIn(OWNER, OLD_PASSWORD);
		const ownerId = String((h.db.user as Row[])[0].id);
		h.db.session = [
			...(h.db.session as Row[]),
			{ id: "other", userId: "someone-else", token: "t", expiresAt: new Date() },
		];

		// Sign-up opens one session of its own, so this is that plus the two
		// sign-ins above — counted rather than hardcoded.
		const ownerSessions = (h.db.session as Row[]).filter(
			(s) => s.userId === ownerId,
		).length;
		expect(ownerSessions).toBeGreaterThan(1);

		const reset = await resetOwnerPasswordWith(h.auth, h.store);

		expect(reset.sessionsSignedOut).toBe(ownerSessions);
		expect(h.db.session as Row[]).toEqual([
			expect.objectContaining({ userId: "someone-else" }),
		]);
		expect(
			(h.db.session as Row[]).some((s) => s.userId === ownerId),
		).toBe(false);
	});

	it("refuses when there is no credential account yet", async () => {
		const h = harness();
		await expect(resetOwnerPasswordWith(h.auth, h.store)).rejects.toThrow(
			ResetOwnerPasswordError,
		);
		await expect(resetOwnerPasswordWith(h.auth, h.store)).rejects.toThrow(
			/finish setup/,
		);
	});

	it("refuses an email that matches nothing, and matches case-insensitively", async () => {
		const h = await withOwner();
		await expect(
			resetOwnerPasswordWith(h.auth, h.store, "nobody@example.test"),
		).rejects.toThrow(/No password account for nobody@example.test/);

		const reset = await resetOwnerPasswordWith(h.auth, h.store, "OWNER@EXAMPLE.TEST");
		expect(reset.email).toBe(OWNER);
	});

	it("asks for --email rather than guessing between two accounts", async () => {
		const h = await withOwner();
		h.db.user = [
			...(h.db.user as Row[]),
			{ id: "u2", email: "second@example.test", createdAt: new Date() },
		];
		h.db.account = [
			...(h.db.account as Row[]),
			{ id: "a2", userId: "u2", providerId: "credential", password: "x" },
		];

		await expect(resetOwnerPasswordWith(h.auth, h.store)).rejects.toThrow(
			/Pass --email/,
		);
	});

	/**
	 * `internalAdapter.updatePassword` matches on `providerId` and `issuer` and
	 * reports nothing when it matches no row. Without the read-back this would
	 * print a password that does not work.
	 */
	it("refuses to print a password the store did not keep", async () => {
		const h = await withOwner();
		const store: OwnerAccountStore = {
			...h.store,
			readPassword: async () => null,
		};
		await expect(resetOwnerPasswordWith(h.auth, store)).rejects.toThrow(
			/was not stored/,
		);
	});
});

describe("generatePassword", () => {
	it("generates a 20-character url-safe password", () => {
		const password = generatePassword();
		expect(password).toMatch(/^[A-Za-z0-9_-]{20}$/);
		expect(generatePassword()).not.toBe(password);
	});
});
