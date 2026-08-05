// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * `prismalens up` — boot the single-origin API + SPA application.
 */
import { defineCommand } from "citty";
import consola from "consola";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineCommand({
	meta: {
		name: "up",
		description:
			"Boot the packed single-origin PrismaLens app (API + SPA on one port)",
	},
	async run() {
		consola.info("Starting PrismaLens single-origin application...");

		// Ensure static SPA directory is known to Nest AppModule
		const staticDir =
			process.env.PRISMALENS_STATIC_DIR || path.resolve(__dirname, "../public");
		process.env.PRISMALENS_STATIC_DIR = staticDir;

		// Set default database path to local worktree DB if not provided
		if (!process.env.DATABASE_URL) {
			const dbPath = path.resolve(process.cwd(), "prismalens-spike.db");
			process.env.DATABASE_URL = `file:${dbPath}`;
		}

		// Resolve Nest main entry point inside packed artifact or workspace fallback
		const mainPath = path.resolve(__dirname, "../../api/src/main.js");
		try {
			await import(mainPath);
		} catch (err) {
			consola.error("Failed to boot NestJS API main module from:", mainPath);
			throw err;
		}
	},
});
