// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { LIVE_WORKFLOW_STATUSES } from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";

export const FOLDER_BUSY = "A thread is already working in this folder.";

type Db = Pick<Prisma.TransactionClient, "repository" | "investigation">;

const fold = (p: string) =>
	process.platform === "win32" || process.platform === "darwin"
		? p.toLowerCase()
		: p;

/** A realpath that gives up, as unknown, past `ms`: a stalled drive never holds a request. */
const CANONICAL_MS = 3000;

/**
 * Transaction budget for the folder checks (#1020): two serial rounds of canonical
 * lookups, each capped at CANONICAL_MS, plus Prisma's 5 s default for the queries.
 */
export const FOLDER_TX = { timeout: 2 * CANONICAL_MS + 5000 };

/** The folder as the disk names it (links, junctions and short names resolved); null if unknown. */
export async function canonical(
	p: string,
	ms = CANONICAL_MS,
): Promise<string | null> {
	let timer: NodeJS.Timeout | undefined;
	const op = realpath(p);
	op.catch(() => {});
	try {
		return await Promise.race([
			op,
			new Promise<null>((r) => {
				timer = setTimeout(() => r(null), ms);
			}),
		]);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

const drive = (p: string) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());

/**
 * The written path is the disk's own name for it, exactly: letter case counts, since a
 * case-sensitive folder may hold `Alias` linking to `alias`; only a drive letter is folded.
 */
export function sameAsDisk(written: string, real: string): boolean {
	return drive(written) === drive(real);
}

/**
 * True when no part of `p` is a link, junction or short name: the disk names it as written
 * (#1020). Never blocks the event loop; a swap after this check is not caught.
 */
export async function isCanonical(p: string, ms?: number): Promise<boolean> {
	const real = await canonical(p, ms);
	return real !== null && sameAsDisk(resolve(p), real);
}

/** One folder holds the other, or they are the same; both already as the disk names them. */
export function overlaps(a: string, b: string): boolean {
	const within = (root: string, p: string) => {
		const rel = relative(fold(root), fold(p));
		const up = rel === ".." || rel.startsWith(`..${sep}`);
		return rel === "" || (!up && !isAbsolute(rel));
	};
	return within(a, b) || within(b, a);
}

/** `p` as the disk names it, or as written when that is unknown. */
const named = async (p: string) => (await canonical(p)) ?? p;

/** Folders Start git here is turning into repos, one entry per hold; this server admits every run. */
const converting = new Map<symbol, string>();

/** Holds off runs in `folder` and folders nested with it until the returned release, which frees only this hold. */
export function holdConversion(folder: string): () => void {
	const own = Symbol("hold");
	converting.set(own, folder);
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
	const [at, ...held] = await Promise.all(
		[repo.url, ...converting.values()].map(named),
	);
	if (held.some((c) => overlaps(c, at))) return true;
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
	const urls = live.flatMap((r) => (r.repository ? [r.repository.url] : []));
	const [at, ...others] = await Promise.all([folder, ...urls].map(named));
	return others.some((u) => overlaps(u, at));
}
