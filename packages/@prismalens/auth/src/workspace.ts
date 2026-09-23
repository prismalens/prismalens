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
	OPERATOR_SCOPES,
	prismaPairingStore,
	STARTUP_LINK_LABEL,
} from "./pairing.js";

export class WorkspaceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceError";
	}
}

export async function createPairingLinkInWorkspace(
	workspaceDir: string,
	input: { label?: string; scopes?: readonly string[] } = {},
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

/**
 * The link that gives the host its own session (ADR 0004 §8), minted by
 * `pl up` once the API it started in this process is listening. It carries
 * the operator's scopes and is named for this machine.
 *
 * The client is left connected: in `pl up` it can be the API's own.
 */
export async function createStartupLinkInWorkspace(
	workspaceDir: string,
): Promise<CreatedPairingLink> {
	process.env.PRISMALENS_WORKSPACE_DIR = workspaceDir;
	const { prisma } = await import("@prismalens/database");
	return createPairingLink(prismaPairingStore(prisma), {
		label: STARTUP_LINK_LABEL,
		scopes: OPERATOR_SCOPES,
	});
}
