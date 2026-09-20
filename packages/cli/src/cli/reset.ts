// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl reset` — delete the workspace (database, secrets, logs) after naming the
 * path and asking (#606). Refuses a directory that is not a PrismaLens
 * workspace, so a mistyped `--workspace` or `PRISMALENS_WORKSPACE_DIR=$HOME`
 * never becomes `rm -rf $HOME`.
 */

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { parse, resolve } from "node:path";
import { defineCommand } from "citty";
import consola from "consola";

const WORKSPACE_MARKER = "prismalens.db";

/** Why this path must not be deleted, or null when it is a workspace. */
export function refuseReason(dir: string, home = homedir()): string | null {
	const abs = resolve(dir);
	if (abs === parse(abs).root || abs === resolve(home)) {
		return `${abs} is not a workspace directory`;
	}
	if (!existsSync(abs)) return `${abs} does not exist; nothing to reset`;
	if (!existsSync(resolve(abs, WORKSPACE_MARKER))) {
		return `${abs} has no ${WORKSPACE_MARKER}, so it is not a PrismaLens workspace`;
	}
	return null;
}

export default defineCommand({
	meta: {
		name: "reset",
		description:
			"Delete the workspace: database, secrets and logs. Stop `pl up` first.",
	},
	args: {
		workspace: {
			type: "string",
			description:
				"Workspace to delete (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
		yes: {
			type: "boolean",
			description: "Skip the confirmation prompt",
		},
	},
	async run({ args }) {
		if (args.workspace) {
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		}
		const { getAppDataDir } = (await import("@prismalens/config")) as {
			getAppDataDir: () => string;
		};
		const dir = resolve(getAppDataDir());
		const reason = refuseReason(dir);
		if (reason) {
			consola.error(reason);
			process.exit(1);
		}

		if (!args.yes) {
			const confirmed = await consola.prompt(
				`Delete ${dir} and everything in it? This cannot be undone.`,
				{ type: "confirm", initial: false, cancel: "default" },
			);
			if (confirmed !== true) {
				consola.info("Nothing deleted.");
				return;
			}
		}
		rmSync(dir, { recursive: true, force: true });
		consola.success(`Deleted ${dir}. The next \`pl up\` starts from setup.`);
	},
});
