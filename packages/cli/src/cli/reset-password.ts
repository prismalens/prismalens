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
		 * The CLI is allowed to reach `@prismalens/auth`, and only it.
		 *
		 * `biome.json` used to ban this import from `packages/cli` alongside the
		 * engine's bans. That was an extraction boundary from #40, not a
		 * dependency constraint — the workspace graph is acyclic and
		 * `@prismalens/auth` depends on nothing but `config` and `database`. The
		 * ban's only effect was that this command reimplemented better-auth's
		 * scrypt parameters and wrote the hash itself: the same coupling with
		 * none of the safety, holding only while the two agree and breaking a
		 * user's login rather than a build when they stop. Ruled on 2026-09-20;
		 * the engine keeps the full ban, and the CLI keeps the other four.
		 *
		 * Nothing about auth is known here. The password is generated, hashed
		 * and verified inside `@prismalens/auth`; what comes back is an email, a
		 * string to print and a count.
		 */
		const { resetOwnerPassword, ResetOwnerPasswordError } = await import(
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
