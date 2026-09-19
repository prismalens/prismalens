// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl reset-password` — the owner's way back in on a machine with no mail
 * server (#605 edge 8). Sets a generated password on the owner's credential
 * account, signs every session out, and prints the password once. Whoever can
 * run this can already read the workspace, so it grants nothing new.
 */

import { randomBytes, scrypt } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineCommand } from "citty";
import consola from "consola";

interface CredentialAccount {
	accountId: string;
	userId: string;
	email: string;
}

/**
 * better-auth's own password format (`@better-auth/utils` password.node): scrypt
 * N=16384 r=16 p=1, 64-byte key, 16-byte hex salt used as the salt string, NFKC
 * password, stored `salt:key` in hex. Reimplemented because the CLI must not
 * depend on the app's auth layer; the test checks it against a hash better-auth made.
 */
const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;

function scryptKey(password: string, salt: string): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		scrypt(
			password.normalize("NFKC"),
			salt,
			SCRYPT.dkLen,
			{
				N: SCRYPT.N,
				r: SCRYPT.r,
				p: SCRYPT.p,
				maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
			},
			(err, key) => (err ? reject(err) : resolvePromise(key)),
		);
	});
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	return `${salt}:${(await scryptKey(password, salt)).toString("hex")}`;
}

export async function verifyPassword(
	hash: string,
	password: string,
): Promise<boolean> {
	const [salt, key] = hash.split(":");
	if (!salt || !key) return false;
	return (await scryptKey(password, salt)).toString("hex") === key;
}

export function generatePassword(): string {
	return randomBytes(15).toString("base64url");
}

/** Owner credential accounts, optionally narrowed to one email. */
export function findCredentialAccounts(
	db: DatabaseSync,
	email?: string,
): CredentialAccount[] {
	const rows = db
		.prepare(
			`SELECT a."id" AS accountId, u."id" AS userId, u."email" AS email
			 FROM "account" a JOIN "user" u ON u."id" = a."userId"
			 WHERE a."providerId" = 'credential'
			 ORDER BY u."createdAt"`,
		)
		.all() as unknown as CredentialAccount[];
	return email
		? rows.filter((r) => r.email.toLowerCase() === email.toLowerCase())
		: rows;
}

/** Writes the hash and deletes the user's sessions in one transaction; returns sessions removed. */
export function setPassword(
	db: DatabaseSync,
	account: CredentialAccount,
	hash: string,
): number {
	db.exec("BEGIN");
	try {
		db.prepare(`UPDATE "account" SET "password" = ? WHERE "id" = ?`).run(
			hash,
			account.accountId,
		);
		const { changes } = db
			.prepare(`DELETE FROM "session" WHERE "userId" = ?`)
			.run(account.userId);
		db.exec("COMMIT");
		return Number(changes);
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}
}

export default defineCommand({
	meta: {
		name: "reset-password",
		description:
			"Set a new generated password for the owner account and sign every session out",
	},
	args: {
		workspace: {
			type: "string",
			description:
				"Workspace holding the database (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
		email: {
			type: "string",
			description: "Account to reset, when the workspace has more than one",
		},
	},
	async run({ args }) {
		if (args.workspace) {
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		}
		const { getAppDataDir } = (await import("@prismalens/config")) as {
			getAppDataDir: () => string;
		};
		const dbPath = join(getAppDataDir(), "prismalens.db");
		if (!existsSync(dbPath)) {
			consola.error(
				`No database at ${dbPath}. Run \`pl up\` and finish setup first.`,
			);
			process.exit(1);
		}

		const db = new DatabaseSync(dbPath);
		try {
			const accounts = findCredentialAccounts(
				db,
				args.email ? String(args.email) : undefined,
			);
			if (accounts.length === 0) {
				consola.error(
					args.email
						? `No password account for ${args.email}.`
						: "No password account yet. Open the app and finish setup.",
				);
				process.exit(1);
			}
			if (accounts.length > 1) {
				consola.error(
					`More than one account: ${accounts.map((a) => a.email).join(", ")}. Pass --email.`,
				);
				process.exit(1);
			}
			const [account] = accounts;
			const password = generatePassword();
			const signedOut = setPassword(db, account, await hashPassword(password));
			consola.success(
				`Password reset for ${account.email}; ${signedOut} session(s) signed out.`,
			);
			consola.log(`\n  New password: ${password}\n`);
			consola.info("It is shown once. Sign in and store it somewhere safe.");
		} finally {
			db.close();
		}
	},
});
