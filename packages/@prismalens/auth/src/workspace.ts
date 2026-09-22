// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pairing straight against a workspace's database, for the CLI. The CLI may
 * depend on this package and not on `@prismalens/database` (ADR 0005 §3), so
 * the database is opened here. Whoever can run this already holds the
 * workspace; it grants nothing new.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type CreatedPairingLink,
	createPairingLink,
	prismaPairingStore,
} from "./pairing.js";

export class WorkspaceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceError";
	}
}

export async function createPairingLinkInWorkspace(
	workspaceDir: string,
	input: { label?: string } = {},
): Promise<CreatedPairingLink> {
	// `@prismalens/database` builds its client from the config at import time,
	// so the workspace has to be chosen before the import, not after.
	process.env.PRISMALENS_WORKSPACE_DIR = workspaceDir;
	const dbPath = join(workspaceDir, "prismalens.db");
	if (!existsSync(dbPath)) {
		throw new WorkspaceError(
			`No database at ${dbPath}. Run \`pl up\` once, then pair.`,
		);
	}
	const { prisma } = await import("@prismalens/database");
	try {
		return await createPairingLink(prismaPairingStore(prisma), input);
	} finally {
		await prisma.$disconnect();
	}
}
