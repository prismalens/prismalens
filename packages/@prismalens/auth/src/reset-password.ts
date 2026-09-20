// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The owner's way back in on a machine with no mail server (#605 edge 8).
 *
 * This lives here, not in the CLI, because a password hash is an auth
 * semantic and [[0005-runtime]] §3 keeps those behind this package. The CLI
 * previously reimplemented better-auth's scrypt parameters and wrote the hash
 * itself; that worked only for as long as the two agreed, and the golden-vector
 * test that pinned it could only report the disagreement *after* an upgrade had
 * already shipped a hash sign-in could not verify. better-auth has an open
 * argon2id issue upstream, so that day was coming.
 *
 * Instead the hash is produced by the same `password.hash` the sign-in path
 * verifies with, through `auth.$context`. Building the context does not start a
 * server, open a port or register a route — it resolves the adapter and the
 * configured primitives — so the CLI can call this in its own process. This is
 * the shape Gitea (`user.SetPassword`) and Django (`set_password`) use for the
 * same command.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAuth } from "./auth.js";

export type ResetOwnerPasswordReason =
	| "no-database"
	| "no-account"
	| "ambiguous"
	| "not-written";

export class ResetOwnerPasswordError extends Error {
	constructor(
		readonly reason: ResetOwnerPasswordReason,
		message: string,
	) {
		super(message);
		this.name = "ResetOwnerPasswordError";
	}
}

export interface OwnerPasswordReset {
	email: string;
	/** Shown once by the caller and never stored anywhere. */
	password: string;
	sessionsSignedOut: number;
}

/** 20 characters of base64url from 15 random bytes. */
export function generatePassword(): string {
	return randomBytes(15).toString("base64url");
}

export interface CredentialAccount {
	id: string;
	userId: string;
	email: string;
}

/**
 * The rows this needs, and nothing else. Keeping it a port is what lets the
 * round-trip test below drive the real better-auth primitives without a
 * migrated SQLite file behind them.
 */
/**
 * The slice of a better-auth instance this needs: the primitives its own
 * context exposes. Structural rather than `Auth`, so a test can pass an
 * instance built on a different adapter and still exercise the real hashing.
 */
export interface PasswordCapableAuth {
	$context: Promise<{
		password: {
			hash: (password: string) => Promise<string>;
			verify: (data: { password: string; hash: string }) => Promise<boolean>;
		};
		internalAdapter: {
			updatePassword: (userId: string, password: string) => Promise<unknown>;
		};
	}>;
}

export interface OwnerAccountStore {
	/** Credential accounts, oldest user first. */
	listCredentialAccounts(): Promise<CredentialAccount[]>;
	/** The hash currently stored on an account, for the write-landed check. */
	readPassword(accountId: string): Promise<string | null>;
	/** Sign every session of this user out; returns how many were removed. */
	deleteSessions(userId: string): Promise<number>;
}

/**
 * Set a new generated password on the workspace's owner account, sign every
 * session out, and return the password for the caller to print once.
 *
 * @param workspaceDir the directory holding `prismalens.db`
 * @param email required only when the workspace somehow has more than one
 *   credential account; ADR 0001 §13 allows exactly one.
 */
export async function resetOwnerPassword(
	workspaceDir: string,
	email?: string,
): Promise<OwnerPasswordReset> {
	// `@prismalens/database` builds its client from the config at import time,
	// so the workspace has to be chosen before the import, not after.
	process.env.PRISMALENS_WORKSPACE_DIR = workspaceDir;

	const dbPath = join(workspaceDir, "prismalens.db");
	if (!existsSync(dbPath)) {
		throw new ResetOwnerPasswordError(
			"no-database",
			`No database at ${dbPath}. Run \`pl up\` and finish setup first.`,
		);
	}

	const { prisma } = await import("@prismalens/database");
	const { getOrCreateAuthSecret } = await import("@prismalens/config");

	const store: OwnerAccountStore = {
		// Narrowed by email in JS rather than in the query: SQLite has no
		// case-insensitive `mode` in Prisma, and a workspace has at most a
		// handful of accounts.
		listCredentialAccounts: async () =>
			(
				await prisma.account.findMany({
					where: { providerId: "credential" },
					select: {
						id: true,
						userId: true,
						user: { select: { email: true } },
					},
					orderBy: { user: { createdAt: "asc" } },
				})
			).map((a) => ({ id: a.id, userId: a.userId, email: a.user.email })),
		readPassword: async (accountId) =>
			(
				await prisma.account.findUnique({
					where: { id: accountId },
					select: { password: true },
				})
			)?.password ?? null,
		deleteSessions: async (userId) =>
			(await prisma.session.deleteMany({ where: { userId } })).count,
	};

	// baseURL and the cookie settings are unused on this path — nothing here
	// builds a request — but `betterAuth()` wants a complete configuration, and
	// the secret has to be the real one so the instance matches the running app.
	const auth = createAuth(prisma, {
		baseURL: "http://localhost",
		secret: getOrCreateAuthSecret(),
		secureCookies: false,
	});

	return resetOwnerPasswordWith(auth, store, email);
}

/**
 * The reset itself, against an already-built auth instance and store.
 *
 * Exported so a test can drive it with a real `betterAuth()` on the in-memory
 * adapter: the hash, the update and the verification are then the same code the
 * running app uses, with only the storage swapped.
 */
export async function resetOwnerPasswordWith(
	auth: PasswordCapableAuth,
	store: OwnerAccountStore,
	email?: string,
): Promise<OwnerPasswordReset> {
	const accounts = await store.listCredentialAccounts();
	const matched = email
		? accounts.filter((a) => a.email.toLowerCase() === email.toLowerCase())
		: accounts;

	if (matched.length === 0) {
		throw new ResetOwnerPasswordError(
			"no-account",
			email
				? `No password account for ${email}.`
				: "No password account yet. Open the app and finish setup.",
		);
	}
	if (matched.length > 1) {
		throw new ResetOwnerPasswordError(
			"ambiguous",
			`More than one account: ${matched
				.map((a) => a.email)
				.join(", ")}. Pass --email.`,
		);
	}
	const [account] = matched;

	const ctx = await auth.$context;
	const password = generatePassword();
	await ctx.internalAdapter.updatePassword(
		account.userId,
		await ctx.password.hash(password),
	);

	/**
	 * `updatePassword` filters on `providerId` and `issuer` and reports nothing
	 * when it matches no row, so a silent no-op is possible. Verifying the
	 * stored hash with the same primitive sign-in uses is the only check that
	 * answers the question this command exists to answer: can the owner sign in
	 * with what is about to be printed?
	 */
	const written = await store.readPassword(account.id);
	const stored =
		written != null && (await ctx.password.verify({ password, hash: written }));
	if (!stored) {
		throw new ResetOwnerPasswordError(
			"not-written",
			"The new password was not stored: better-auth did not update the credential account. Nothing has changed, and the old password still works.",
		);
	}

	return {
		email: account.email,
		password,
		sessionsSignedOut: await store.deleteSessions(account.userId),
	};
}
