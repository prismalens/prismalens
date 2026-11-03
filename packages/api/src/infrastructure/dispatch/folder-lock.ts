// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isAbsolute, relative } from "node:path";
import { LIVE_WORKFLOW_STATUSES } from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";

export const FOLDER_BUSY = "A thread is already working in this folder.";

type Db = Pick<Prisma.TransactionClient, "repository" | "investigation">;

const fold = (p: string) =>
	process.platform === "win32" || process.platform === "darwin"
		? p.toLowerCase()
		: p;

/** One folder holds the other, or they are the same. */
export function overlaps(a: string, b: string): boolean {
	const within = (root: string, p: string) => {
		const rel = relative(fold(root), fold(p));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	};
	return within(a, b) || within(b, a);
}

/**
 * A plain folder runs in place, so at most one live run may work in it or in a folder
 * nested with it (#1020). Run inside the transaction that admits the run.
 */
export async function folderBusy(
	db: Db,
	repositoryId: string,
	selfId?: string,
): Promise<boolean> {
	const repo = await db.repository.findUnique({
		where: { id: repositoryId },
		select: { plain: true, url: true },
	});
	if (!repo?.plain) return false;
	const live = await db.investigation.findMany({
		where: {
			...(selfId ? { id: { not: selfId } } : {}),
			status: { in: [...LIVE_WORKFLOW_STATUSES] },
			repository: { plain: true },
		},
		select: { repository: { select: { url: true } } },
	});
	return live.some((r) => r.repository && overlaps(r.repository.url, repo.url));
}
