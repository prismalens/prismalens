// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
		// Compiled location is dist/src/cli/up.js -> dist/public is ../../public
		const staticDir =
			process.env.PRISMALENS_STATIC_DIR ||
			path.resolve(__dirname, "../../public");
		process.env.PRISMALENS_STATIC_DIR = staticDir;

		// Ensure PRISMALENS_WORKSPACE_DIR is set to isolate app database
		if (!process.env.PRISMALENS_WORKSPACE_DIR) {
			const workspaceDir = path.resolve(process.cwd(), ".prismalens-workspace");
			process.env.PRISMALENS_WORKSPACE_DIR = workspaceDir;
		}

		// Resolve Nest main entry point inside packed artifact
		const mainPath = fs.existsSync(
			path.resolve(__dirname, "../../api/src/main.js"),
		)
			? path.resolve(__dirname, "../../api/src/main.js")
			: path.resolve(__dirname, "../../api/main.js");
		try {
			await import(mainPath);
		} catch (err) {
			consola.error("Failed to boot NestJS API main module from:", mainPath);
			throw err;
		}
	},
});
