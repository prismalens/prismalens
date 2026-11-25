// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrTone, ThreadContext, ThreadLinks } from "@prismalens/contracts";
import type { ReactNode } from "react";
import type { Details, DetailsPr } from "@/components/kit/details-registry";
import {
	checksParts,
	MERGE_WORD,
	PR_TONE_WORD,
	type PullRequestView,
	REVIEW_WORD,
} from "./PullRequests";

type Opener = () => void;

const OS_WORD: Record<ThreadContext["machine"]["os"], string> = {
	windows: "Windows",
	macos: "macOS",
	linux: "Linux",
	other: "",
};

type Workspace = NonNullable<ThreadContext["workspace"]>;
const folderName = (cwd: string) =>
	cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
// A single worktree's repo is always named "repo": its source names it instead.
const reposName = (w: Workspace, source: string | null) =>
	w.repos.length > 1 ? `${w.repos[0]?.name} + ${w.repos.length - 1}` : source;
/**
 * Each layout's name for its place, never an internal folder (#1101 category 21): a worktree
 * by its repo, a scratch folder by what it is, the person's own folder by its name.
 */
const LAYOUT_PLACE: Record<
	Workspace["layout"],
	(w: Workspace, source: string | null) => string | null
> = {
	unmapped: () => "Scratch folder",
	single: reposName,
	multi: reposName,
	folder: (w) => folderName(w.cwd),
	in_place: (w) => folderName(w.cwd),
};

/** The card's PR tone: only failing and needs-attention carry colour (sheet §9.1). */
function prTone(pr: PullRequestView): DetailsPr["tone"] {
	const byTone: Record<PrTone, DetailsPr["tone"]> = {
		failing: "failing",
		attention: "attention",
		merged: "merged",
		closed: "merged",
		ready: "passing",
		open: "passing",
		draft: "passing",
		unknown: "passing",
	};
	return pr.checks.pending > 0 && pr.tone !== "failing"
		? "running"
		: byTone[pr.tone];
}

function prOf(pr: PullRequestView | undefined): DetailsPr | undefined {
	if (!pr) return undefined;
	const c = pr.checks;
	const counted = c.total > 0 && c.state !== "none" && c.state !== "unknown";
	const review = REVIEW_WORD[pr.review];
	const mergeState =
		pr.mergeState ?? (pr.conflicts === true ? "conflicts" : undefined);
	const merge =
		pr.state === "open" && mergeState ? MERGE_WORD[mergeState] : null;
	const words = counted
		? (checksParts(c) ?? []).map((p) => p.text).join(" · ")
		: "";
	return {
		number: pr.number,
		// "Failing" beside "1 failing" says it twice and pushes the number out of the row.
		word: pr.tone === "failing" && words ? "" : PR_TONE_WORD[pr.tone],
		tone: prTone(pr),
		...(words ? { checks: words } : {}),
		...(pr.title ? { title: pr.title } : {}),
		...(pr.headRef && pr.baseRef
			? { branches: { head: pr.headRef, base: pr.baseRef } }
			: {}),
		...(review ? { review: { state: pr.review, word: review } } : {}),
		...(merge && mergeState
			? { merge: { state: mergeState, word: merge[0] } }
			: {}),
	};
}

/** Threads and sub-agents it started, and how many run now, from stored links (#1176 D16). */
export function startedCount(links: ThreadLinks | undefined): {
	count: number;
	running: number;
} {
	const started = links?.started ?? [];
	const subagents = links?.subagents ?? [];
	return {
		count: started.length + subagents.length,
		running:
			started.filter((l) => l.state === "running").length +
			subagents.filter((s) => s.state === "running").length,
	};
}

/**
 * The details card's data for a thread (sheet §3): what the registry draws,
 * from the context and the start links the panel already loads.
 */
export function detailsOf(o: {
	context: ThreadContext;
	links: ThreadLinks | undefined;
	/** The box's git action and folder opener, drawn by the caller. */
	actions?: ReactNode;
	folder?: ReactNode;
	/** The project's or service's name, when the thread has one. */
	project?: string | null;
	/** The repo URL or folder the worktree came from, which names it when nothing else does. */
	source?: string | null;
	open: {
		diff?: Opener;
		pr?: Opener;
		startedBy?: Opener;
		started?: Opener;
		kind?: Opener;
	};
}): Details {
	const { context, links, open } = o;
	const pr = prOf(context.pullRequests[0] as PullRequestView | undefined);
	// An alert thread's severity, firing, alert and cause live in its header and situation
	// card; its box holds the same work, place and lineage as any thread (#1101 one fact, one place).
	const repos = context.workspace?.repos ?? [];
	const branchRepo = repos.find((r) => r.branch);
	const branch = branchRepo?.branch ?? undefined;
	// A detached worktree names its tip instead of a branch (#1176 F2).
	const loose = branchRepo ? undefined : repos.find((r) => r.detached && r.tip);
	const detached = loose?.tip?.slice(0, 7);
	const sync =
		branchRepo &&
		typeof branchRepo.ahead === "number" &&
		typeof branchRepo.behind === "number"
			? { ahead: branchRepo.ahead, behind: branchRepo.behind }
			: undefined;
	const counted = repos.filter(
		(r) => r.additions !== null && r.deletions !== null,
	);
	const by = links?.startedBy ?? null;
	const { count: started, running } = startedCount(links);
	const os = OS_WORD[context.machine.os];
	const cwd = context.workspace?.cwd;
	const ws = context.workspace;
	const source = o.source ? folderName(o.source).replace(/\.git$/, "") : null;
	const name =
		o.project ??
		(context.kind === "project" ? context.project.name : null) ??
		(ws ? LAYOUT_PLACE[ws.layout](ws, source) : null);
	return {
		kind: "thread",
		machine: os
			? `${context.machine.hostName} · ${os}`
			: context.machine.hostName,
		...(branch ? { branch } : {}),
		...(detached ? { detached } : {}),
		...(detached && loose?.from ? { from: loose.from } : {}),
		...(sync ? { sync } : {}),
		...(name ? { place: { name, ...(cwd ? { path: cwd } : {}) } } : {}),
		...(o.folder ? { folder: o.folder } : {}),
		...(o.actions ? { actions: o.actions } : {}),
		...(started ? { started } : {}),
		...(running ? { running } : {}),
		...(counted.length
			? {
					changes: {
						added: counted.reduce((n, r) => n + (r.additions ?? 0), 0),
						removed: counted.reduce((n, r) => n + (r.deletions ?? 0), 0),
					},
				}
			: {}),
		...(pr ? { pr } : {}),
		...(by ? { startedBy: { title: by.title ?? "Thread", via: by.via } } : {}),
		...(context.kind === "schedule" ? { schedule: context.schedule.name } : {}),
		open: {
			diff: open.diff,
			pr: open.pr,
			startedBy: by ? open.startedBy : undefined,
			started: open.started,
		},
	};
}
