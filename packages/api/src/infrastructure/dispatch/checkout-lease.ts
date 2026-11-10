// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread a person starts on a local git project may work in their own checkout (#1024,
 * ADR 0004 §2 as amended). The checkout is borrowed: only read-only git ever runs on it,
 * and one lease per canonical working tree admits one live run at a time.
 */
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import type { BorrowedCheckout } from "@prismalens/contracts";
import { LIVE_WORKFLOW_STATUSES } from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	GitMissingError,
	type GitOutput,
	GitSpawnError,
	type SpawnGitOptions,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { checkoutStatus } from "./checkout-status.js";
import { busyAt, CanonicalBusy, canonical, overlaps } from "./folder-lock.js";

export const CHECKOUT_BUSY =
	"A thread is already working in this checkout. Start this one in a new worktree instead.";

/** Said when only ended runs hold the checkout: their agents are not yet proven gone. */
export const CHECKOUT_HELD_BY_ENDED =
	"A thread that ended still holds this checkout until PrismaLens confirms its agent stopped, at most an hour. Start this one in a new worktree, or try again later.";

/** An ended run's lease is released after this, even when its agent cannot be proven gone. */
export const STALE_LEASE_MS = 60 * 60 * 1000;

type LeaseDb = Pick<
	Prisma.TransactionClient,
	"checkoutLease" | "investigation"
>;

/** The only git subcommands that may run on a borrowed checkout; each reads, none writes. */
const READ_ONLY = new Set(["rev-parse", "status", "symbolic-ref"]);

/** Runs git; swapped in tests so a spy sees every call made on a checkout. */
export type GitRunner = (
	args: string[],
	opts: SpawnGitOptions,
) => Promise<GitOutput>;

let runner: GitRunner = spawnGit;
export function setCheckoutGit(next: GitRunner | null): void {
	runner = next ?? spawnGit;
}

/**
 * Leads every git call on a borrowed checkout: its own config may name an fsmonitor hook, which
 * `status` would run. An empty value turns it off on every git version (`false` reads as a path on old ones).
 */
export const NO_FSMONITOR = ["-c", "core.fsmonitor="] as const;

/** git on the user's checkout: a write is refused here, before git sees it (#1024). */
export async function checkoutGit(
	args: string[],
	cwd: string,
): Promise<GitOutput & { filtered?: boolean }> {
	const sub = args[0];
	if (!sub || !READ_ONLY.has(sub))
		return Promise.reject(
			new Error(`git ${sub ?? ""} never runs on a borrowed checkout`),
		);
	const status = sub === "status" ? await checkoutStatus(cwd) : null;
	try {
		const output = await runner([...NO_FSMONITOR, ...args], {
			cwd,
			// Optional locks off: a status here never writes the user's index (git-status(1)).
			env: status?.env ?? {
				...gitEnv({ source: "machine" }),
				GIT_OPTIONAL_LOCKS: "0",
			},
			timeoutMs: GIT_PROBE_TIMEOUT_MS,
		});
		return { ...output, ...(status?.hasFilters ? { filtered: true } : {}) };
	} finally {
		status?.close();
	}
}

/** The checkout could not be read just now (a busy or slow disk, no git): trying again may work, unlike a checkout that is gone. */
export class CheckoutUnreadable extends Error {}

/**
 * The working tree's top level that holds `folder`, as the disk names it. Null when git says
 * it is missing or not a work tree; a read that failed for another reason throws CheckoutUnreadable.
 */
export async function checkoutRoot(folder: string): Promise<string | null> {
	let top: string;
	try {
		top = (
			await checkoutGit(["rev-parse", "--show-toplevel"], folder)
		).stdout.trim();
	} catch (e) {
		if (e instanceof GitMissingError) throw new CheckoutUnreadable(e.message);
		if (e instanceof GitSpawnError && e.timedOut)
			throw new CheckoutUnreadable(
				"Reading your checkout timed out. Try again in a moment.",
			);
		return null;
	}
	if (!top) return null;
	try {
		const root = await canonical(top);
		// git just named this folder: no answer for it is a slow disk, not a missing checkout.
		if (root === null)
			throw new CheckoutUnreadable(
				"Reading your checkout timed out. Try again in a moment.",
			);
		return root;
	} catch (e) {
		if (e instanceof CanonicalBusy)
			throw new CheckoutUnreadable(
				"PrismaLens is busy reading folders. Try again in a moment.",
			);
		throw e;
	}
}

/** Counts from `git status --porcelain=v2`; no path or content is kept (#1024). */
export function dirtyCounts(porcelain: string): BorrowedCheckout["dirty"] {
	const dirty = { staged: 0, unstaged: 0, untracked: 0 };
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("? ")) dirty.untracked++;
		else if (/^[12u] /.test(line)) {
			const xy = line.slice(2, 4);
			if (line[0] === "u") {
				dirty.unstaged++;
				continue;
			}
			if (xy[0] !== ".") dirty.staged++;
			if (xy[1] !== ".") dirty.unstaged++;
		}
	}
	return dirty;
}

/** The checkout as it stands: HEAD, the branch and counts of its changes. */
export async function checkoutState(root: string): Promise<BorrowedCheckout> {
	const head = (await checkoutGit(["rev-parse", "HEAD"], root)).stdout.trim();
	const branch = await checkoutGit(
		["symbolic-ref", "--quiet", "--short", "HEAD"],
		root,
	)
		.then((o) => o.stdout.trim() || null)
		.catch(() => null);
	const status = await checkoutGit(
		["status", "--porcelain=v2", "--untracked-files=normal"],
		root,
	);
	const dirty = dirtyCounts(status.stdout);
	if (status.filtered) dirty.unstaged = null;
	return { path: root, head, branch, dirty };
}

/**
 * Another run works in `path` or a folder nested with it: through a lease its agent still
 * holds, or as a plain folder's live run. Run inside the transaction that admits the run.
 */
export function checkoutBusy(
	db: LeaseDb,
	path: string,
	selfId: string,
): Promise<boolean> {
	return busyAt(db, path, selfId);
}

/** Takes the checkout's lease for `investigationId`, once `checkoutBusy` found it free. */
export async function takeLease(
	db: LeaseDb,
	path: string,
	investigationId: string,
): Promise<void> {
	const generation = randomUUID();
	await db.checkoutLease.upsert({
		where: { canonicalPath: path },
		create: { canonicalPath: path, investigationId, generation },
		update: { investigationId, generation, takenAt: new Date() },
	});
}

/** The checkout an investigation last leased, or null. */
export async function leasedBy(
	db: {
		checkoutLease: {
			findFirst(args: {
				where: { investigationId: string };
				orderBy: { takenAt: "desc" };
				select: { canonicalPath: true };
			}): PromiseLike<{ canonicalPath: string } | null>;
		};
	},
	investigationId: string,
): Promise<string | null> {
	const row = await db.checkoutLease.findFirst({
		where: { investigationId },
		orderBy: { takenAt: "desc" },
		select: { canonicalPath: true },
	});
	return row?.canonicalPath ?? null;
}

/** Whether a run's agent is proven gone; `DispatchService.previousGone` kills what is left of it first. */
export type AgentGone = (
	investigationId: string,
	acpSessionId: string | null,
) => Promise<boolean>;

type LeaseRows = Pick<PrismaService, "checkoutLease" | "investigation">;
type LeaseStore = LeaseRows & {
	$transaction<T>(
		fn: (tx: LeaseRows) => Promise<T>,
		options?: { timeout: number },
	): Promise<T>;
};

/** Reclaims ended runs under the database write lock, fencing both containment and deletion (#1066). */
export async function releaseIfGone(
	db: LeaseStore,
	gone: AgentGone,
	path: string | null = null,
	now: Date = new Date(),
): Promise<{ released: number; failed: number }> {
	const rows = await db.checkoutLease.findMany();
	let released = 0;
	let failed = 0;
	for (const r of rows) {
		if (path && !overlaps(r.canonicalPath, path)) continue;
		// One lease that cannot be read or released must not keep the others.
		released += await db
			.$transaction(
				async (tx) => {
					const where = {
						canonicalPath: r.canonicalPath,
						investigationId: r.investigationId,
						generation: r.generation,
					};
					// A matching no-op write takes SQLite's writer lock before we inspect or contain a receipt.
					const { count } = await tx.checkoutLease.updateMany({
						where,
						data: { takenAt: r.takenAt },
					});
					if (!count) return 0;
					const run = await tx.investigation.findUnique({
						where: { id: r.investigationId },
						select: { status: true, acpSessionId: true, completedAt: true },
					});
					if (
						!run ||
						(LIVE_WORKFLOW_STATUSES as readonly string[]).includes(run.status)
					)
						return 0;
					const ended = (run.completedAt ?? r.takenAt).getTime();
					const stale = now.getTime() - ended >= STALE_LEASE_MS;
					if (
						!stale &&
						!(await withinContainment(
							gone(r.investigationId, run.acpSessionId),
						))
					)
						return 0;
					return (await tx.checkoutLease.deleteMany({ where })).count;
				},
				{ timeout: LEASE_TX_TIMEOUT_MS },
			)
			.catch(() => {
				failed++;
				return 0;
			});
	}
	return { released, failed };
}

/**
 * Containment runs inside the lease transaction, which fences it to this lease's
 * generation. It is bounded below the transaction's timeout: a timed-out rollback
 * would also undo other writes on the shared SQLite connection. Unfinished reads as not gone.
 */
const LEASE_TX_TIMEOUT_MS = 30_000;
export const CONTAINMENT_TIMEOUT_MS = 20_000;
function withinContainment(
	proof: Promise<boolean>,
	ms = CONTAINMENT_TIMEOUT_MS,
): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), ms);
	});
	return Promise.race([proof, late]).finally(() => clearTimeout(timer));
}

/** Why `folder` is busy: a live run, or only ended runs still holding a lease. */
export async function busyReason(
	db: LeaseDb,
	folder: string,
	selfId?: string,
): Promise<string> {
	const held = await db.checkoutLease.findMany({
		where: selfId ? { investigationId: { not: selfId } } : {},
		select: { canonicalPath: true, investigationId: true },
	});
	const near = held.filter((l) => overlaps(l.canonicalPath, folder));
	if (!near.length) return CHECKOUT_BUSY;
	const runs = await db.investigation.findMany({
		where: { id: { in: near.map((l) => l.investigationId) } },
		select: { status: true },
	});
	return runs.every(
		(r) => !(LIVE_WORKFLOW_STATUSES as readonly string[]).includes(r.status),
	)
		? CHECKOUT_HELD_BY_ENDED
		: CHECKOUT_BUSY;
}

/** The run's agent has exited: its lease goes. */
export async function releaseLease(
	db: Pick<LeaseRows, "checkoutLease">,
	investigationId: string,
): Promise<void> {
	await db.checkoutLease.deleteMany({ where: { investigationId } });
}

/** Two canonical paths name one checkout; case folds where the disk does. */
export function sameCheckout(a: string, b: string): boolean {
	const fold = (p: string) =>
		process.platform === "win32" || process.platform === "darwin"
			? p.toLowerCase()
			: p;
	return relative(fold(a), fold(b)) === "";
}
