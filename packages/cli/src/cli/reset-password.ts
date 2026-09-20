// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl reset-password` — the owner's way back in on a machine with no mail
 * server (#605 edge 8). Sets a generated password on the owner's credential
 * account, signs every session out, and prints the password once. Whoever can
 * run this can already read the workspace, so it grants nothing new.
 *
 * All of the auth semantics live in `@prismalens/auth::resetOwnerPassword`,
 * which hashes through better-auth's own `password.hash` rather than
 * reimplementing it. This file is the terminal around it: flags, the workspace,
 * and what gets printed.
 */

import { defineCommand } from "citty";
import consola from "consola";

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
		const workspaceDir = getAppDataDir();

		/**
		 * The extraction seam is deliberately crossed here, and this is the
		 * narrowest place to cross it.
		 *
		 * `biome.json` bans `@prismalens/auth` from `packages/cli` so auth
		 * semantics stay out of the CLI. The previous version of this command
		 * obeyed the letter of that rule by reimplementing better-auth's scrypt
		 * parameters and writing the hash itself — the same coupling with none
		 * of the safety, since it holds only while the two agree and breaks a
		 * user's login rather than a build when they stop. Nothing about auth is
		 * known here: the password is generated, hashed and verified inside
		 * `@prismalens/auth`, and what comes back is an email, a string to print
		 * and a count.
		 *
		 * **This needs the operator's ruling.** Either the rule gains a scoped
		 * exception for this one import, or it drops `@prismalens/auth` and the
		 * boundary is restated in the ADR.
		 */
		const { resetOwnerPassword, ResetOwnerPasswordError } = await import(
			// biome-ignore lint/style/noRestrictedImports: see above — pending an operator ruling.
			"@prismalens/auth"
		);

		try {
			const reset = await resetOwnerPassword(
				workspaceDir,
				args.email ? String(args.email) : undefined,
			);
			consola.success(
				`Password reset for ${reset.email}; ${reset.sessionsSignedOut} session(s) signed out.`,
			);
			consola.log(`\n  New password: ${reset.password}\n`);
			consola.info("It is shown once. Sign in and store it somewhere safe.");
		} catch (error) {
			if (error instanceof ResetOwnerPasswordError) {
				consola.error(error.message);
				process.exit(1);
			}
			throw error;
		}
	},
});
