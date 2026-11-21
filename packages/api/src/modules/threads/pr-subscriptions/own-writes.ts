// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What PrismaLens itself wrote never comes back as an event (#1179 D9): the connected
 * account's comments, the panel's replies, the ledger #1131 appends, and the thread's own
 * pushes. Text alone never makes an item own.
 */
import { ownTextHash } from "@prismalens/contracts";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../../core/harness/git-spawn.js";
import { gitDirOf } from "../../investigations/remote-heads.js";
import { baseEnv } from "../../investigations/worktree-changes.js";
import type { SnapItem } from "./derive.js";

export interface LedgerRow {
	source: string;
	hostId: string | null;
	account: string;
	textHash: string;
	createdAt: Date;
}

export interface OwnFacts {
	viewer: string | null;
	/** The PR rows' `detail.own`, by activity source. */
	detailOwn: readonly { source: string; id: number }[];
	ledger: readonly LedgerRow[];
}

const LEDGER_WINDOW_MS = 60 * 60_000;

/** The activity source name the panel and the ledger use for one of our sources. */
export function ledgerSource(s: SnapItem["source"]): string {
	return s === "ic"
		? "issue_comment"
		: s === "rc"
			? "review_comment"
			: s === "rv"
				? "review"
				: "note";
}

export function isOwnItem(i: SnapItem, f: OwnFacts): boolean {
	const login = i.login?.toLowerCase() ?? null;
	if (login && f.viewer && login === f.viewer.toLowerCase()) return true;
	const source = ledgerSource(i.source);
	if (f.detailOwn.some((o) => o.source === source && o.id === i.id))
		return true;
	if (f.ledger.some((r) => r.source === source && r.hostId === String(i.id)))
		return true;
	if (!login) return false;
	const created = i.createdAt ? Date.parse(i.createdAt) : Number.NaN;
	const hash = ownTextHash(i.body);
	return f.ledger.some(
		(r) =>
			r.hostId === null &&
			r.source === source &&
			r.account.toLowerCase() === login &&
			Number.isFinite(created) &&
			Math.abs(created - r.createdAt.getTime()) <= LEDGER_WINDOW_MS &&
			r.textHash === hash,
	);
}

/** The thread pushed it: one of its workspace repos has `refs/heads/<ref>` at `sha`. */
export async function ownPush(
	dirs: readonly string[],
	ref: string | null,
	sha: string | null,
): Promise<boolean> {
	if (!ref || !sha) return false;
	for (const dir of dirs) {
		if (!(await gitDirOf(dir))) continue;
		const out = await spawnGit(
			[
				"-c",
				"core.fsmonitor=false",
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/heads/${ref}`,
			],
			{ cwd: dir, timeoutMs: GIT_PROBE_TIMEOUT_MS, env: baseEnv() },
		).catch(() => null);
		if (out?.stdout.trim().toLowerCase() === sha.toLowerCase()) return true;
	}
	return false;
}
