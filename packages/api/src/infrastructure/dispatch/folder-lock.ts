// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { LIVE_WORKFLOW_STATUSES } from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";

export const FOLDER_BUSY = "A thread is already working in this folder.";

type Db = Pick<Prisma.TransactionClient, "repository" | "investigation">;

const fold = (p: string) =>
	process.platform === "win32" || process.platform === "darwin"
		? p.toLowerCase()
		: p;

/** The folder as the disk names it: links, junctions and short names resolved. */
export function canonical(p: string): string {
	try {
		return realpathSync.native(p);
	} catch {
		return p;
	}
}

/**
 * True when no part of `p` is a link, junction or short name: the disk names it as written
 * (letter case aside where the disk ignores it). A swap after this check is not caught (#1020).
 */
export function isCanonical(p: string): boolean {
	try {
		return fold(realpathSync.native(p)) === fold(resolve(p));
	} catch {
		return false;
	}
}

/** One folder holds the other, or they are the same, however each path reaches it. */
export function overlaps(a: string, b: string): boolean {
	const within = (root: string, p: string) => {
		const rel = relative(fold(canonical(root)), fold(canonical(p)));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	};
	return within(a, b) || within(b, a);
}

/** Folders Start git here is turning into repos, one entry per hold; this server admits every run. */
const converting = new Map<symbol, string>();

/** Holds off runs in `folder` and folders nested with it until the returned release, which frees only this hold. */
export function holdConversion(folder: string): () => void {
	const own = Symbol("hold");
	converting.set(own, canonical(folder));
	return () => {
		converting.delete(own);
	};
}

/**
 * A plain folder runs in place, so at most one live run may work in it or in a folder
 * nested with it, and none while it is turning into a repo (#1020). Run inside the
 * transaction that admits the run.
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
	if ([...converting.values()].some((c) => overlaps(c, repo.url))) return true;
	return liveIn(db, repo.url, selfId);
}

/** A live run of any plain folder nested with `folder`, or the same one, other than `selfId`. */
export async function liveIn(
	db: { investigation: Pick<Db["investigation"], "findMany"> },
	folder: string,
	selfId?: string,
): Promise<boolean> {
	const live = await db.investigation.findMany({
		where: {
			...(selfId ? { id: { not: selfId } } : {}),
			status: { in: [...LIVE_WORKFLOW_STATUSES] },
			repository: { plain: true },
		},
		select: { repository: { select: { url: true } } },
	});
	return live.some((r) => r.repository && overlaps(r.repository.url, folder));
}
