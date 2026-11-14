// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitStateKind, PrHost, PullRequest } from "@prismalens/contracts";

/** The details card's one primary git action (#1101 - Wave 2: thread UX hill climb, round 2). */
export type GitAction =
	| "push"
	| "createPr"
	| "fixChecks"
	| "resolveConflicts"
	| "restoreBranch"
	| "reread"
	| "markReady"
	| "viewPr";

export interface GitState {
	/** The workspace layout; folder and unmapped have no branch to act on. */
	layout: "unmapped" | "single" | "multi" | "folder" | "in_place" | null;
	branch: string | null;
	/** Commits ahead of the upstream; null with no upstream or unread. */
	ahead: number | null;
	/** Live changes in the worktree, null when unread. */
	changed: boolean | null;
	pullRequests: readonly Pick<
		PullRequest,
		"state" | "checks" | "conflicts" | "mergeState" | "source" | "headRef"
	>[];
	/** The branch was looked up on its code host, so no branch PR means none exists. */
	lookedUp: boolean;
	/** The worktree's own git state; it outranks the PR's (#1101 bar 15.1). */
	git?: GitStateKind | null;
}

/** This branch's own PR: found from the branch, or one whose head is the branch. */
export function branchPr<P extends Pick<PullRequest, "source" | "headRef">>(
	prs: readonly P[],
	branch: string | null,
): P | undefined {
	return prs.find(
		(p) => p.source === "branch" || (!!branch && p.headRef === branch),
	);
}

const OWN_BRANCH = new Set<GitState["layout"]>(["single", "multi"]);
const OWN_GIT = new Set<GitState["layout"]>(["single", "multi", "in_place"]);
const GIT_STEP: Record<GitStateKind, GitAction> = {
	conflict: "resolveConflicts",
	rewritten: "reread",
	gone: "restoreBranch",
};

/**
 * One action from git and PR state, never two that contradict; null whenever
 * a fact it rests on is unknown, so the card shows no action rather than a wrong one.
 */
export function gitAction(s: GitState): GitAction | null {
	if (s.git && s.layout && OWN_GIT.has(s.layout)) return GIT_STEP[s.git];
	if (
		!s.branch ||
		!s.layout ||
		s.layout === "folder" ||
		s.layout === "unmapped"
	)
		return null;
	const pr = branchPr(s.pullRequests, s.branch);
	if (pr) {
		if (pr.state !== "open" && pr.state !== "draft") return "viewPr";
		if (pr.conflicts === true || pr.mergeState === "conflicts")
			return "resolveConflicts";
		if (s.ahead !== null && s.ahead > 0) return "push";
		if (pr.checks.state === "failing") return "fixChecks";
		if (pr.state === "draft") return "markReady";
		return "viewPr";
	}
	// A linked PR with no head may be this branch's: its state is unknown.
	if (s.pullRequests.some((p) => !p.headRef)) return null;
	if (s.ahead !== null && s.ahead > 0) return "push";
	if (!OWN_BRANCH.has(s.layout)) return null;
	if (s.ahead === null) return s.changed ? "push" : null;
	return s.lookedUp ? "createPr" : null;
}

/** The code host a remote URL names, for its own words (`MR` on GitLab). */
export function hostOfUrl(url: string | undefined): PrHost {
	const m =
		/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)/.exec(
			url?.trim() ?? "",
		);
	const host = m?.[1]?.toLowerCase() ?? "";
	if (host === "github.com" || host.endsWith(".github.com")) return "github";
	if (host === "gitlab.com" || host.startsWith("gitlab.")) return "gitlab";
	return "other";
}
