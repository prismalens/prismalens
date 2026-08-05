// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl up` — boot the whole app as ONE process on ONE port, with no external
 * services: the NestJS API, the SPA it serves from its own static dir, and a
 * SQLite database created on first run.
 *
 * Every path below is resolved from the INSTALLED package, never from a repo
 * checkout: `scripts/pack-cli.mjs` copies each first-party package into this
 * package's own `node_modules/@prismalens/<name>`, so `require.resolve` finds
 * exactly the copy that shipped. That matters most for the forked investigation
 * child — `@prismalens/worker` must resolve inside the install, not against a
 * developer's monorepo.
 */

import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineCommand } from "citty";
import consola from "consola";

const require = createRequire(import.meta.url);

interface PackagedApi {
	/** Directory of the installed `@prismalens/api`. */
	dir: string;
	/** Absolute path to its compiled Nest entrypoint. */
	main: string;
	/** Absolute path to the built SPA it serves. */
	staticDir: string;
}

function resolvePackagedApi(): PackagedApi {
	let manifestPath: string;
	try {
		manifestPath = require.resolve("@prismalens/api/package.json");
	} catch {
		throw new Error(
			"`pl up` needs the packaged application. It resolves @prismalens/api " +
				"from this package's own node_modules, which only the published " +
				"tarball carries (see scripts/pack-cli.mjs). In the repo, run " +
				"`pnpm dev` instead.",
		);
	}
	const dir = dirname(manifestPath);
	const manifest = require(manifestPath) as { main?: string };
	if (!manifest.main) {
		throw new Error(`@prismalens/api at ${dir} declares no "main"`);
	}
	const main = join(dir, manifest.main);
	if (!existsSync(main)) {
		throw new Error(`@prismalens/api "main" points at a missing file: ${main}`);
	}
	const staticDir = process.env.PRISMALENS_STATIC_DIR ?? join(dir, "public");
	if (!existsSync(join(staticDir, "index.html"))) {
		throw new Error(
			`No SPA at ${staticDir}: index.html is missing. The packed artifact is ` +
				"incomplete — `pl up` would serve an API with no user interface.",
		);
	}
	return { dir, main, staticDir };
}

export default defineCommand({
	meta: {
		name: "up",
		description:
			"Run PrismaLens as a single process: API and dashboard on one port, SQLite, no external services",
	},
	args: {
		port: {
			type: "string",
			description: "Port to listen on (default 3001, or PRISMALENS_PORT)",
		},
		host: {
			type: "string",
			description: "Host to bind (default localhost, or PRISMALENS_HOST)",
		},
		workspace: {
			type: "string",
			description:
				"Data directory for the database and secrets (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
	},
	async run({ args }) {
		const app = resolvePackagedApi();

		if (args.port) process.env.PRISMALENS_PORT = String(args.port);
		if (args.host) process.env.PRISMALENS_HOST = String(args.host);
		if (args.workspace) {
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		}
		process.env.PRISMALENS_STATIC_DIR = app.staticDir;

		// @prismalens/config derives every on-disk path from this directory —
		// PRISMALENS_DB_URL is ignored, so the workspace dir is the ONLY knob.
		const { getAppDataDir, ensureAppDataDir } = (await import(
			"@prismalens/config"
		)) as {
			getAppDataDir: () => string;
			ensureAppDataDir: () => string;
		};
		ensureAppDataDir();
		const workspaceDir = getAppDataDir();
		mkdirSync(workspaceDir, { recursive: true });

		// Apply the shipped migration SQL through the better-sqlite3 driver. The
		// `prisma` CLI is NOT in this package's dependency closure and must never
		// be invoked at user runtime.
		const dbFile = join(workspaceDir, "prismalens.db");
		const fresh = !existsSync(dbFile);
		const { applyMigrations } = (await import(
			"@prismalens/database/migrate"
		)) as {
			applyMigrations: (
				file: string,
			) => Promise<{ applied: string[]; alreadyApplied: string[] }>;
		};
		const migrated = await applyMigrations(dbFile);
		if (migrated.applied.length > 0) {
			consola.info(
				`${fresh ? "Created" : "Migrated"} ${dbFile} (${migrated.applied.join(", ")})`,
			);
		}

		consola.info(`Workspace: ${workspaceDir}`);
		consola.info(`Dashboard: ${app.staticDir}`);

		// Import, not fork: `pl up` is ONE process. The API forks its own child
		// per investigation, and that child resolves @prismalens/worker from this
		// same install.
		await import(pathToFileURL(app.main).href);
	},
});
