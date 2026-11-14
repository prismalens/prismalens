// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	capitalTerm,
	type GitState,
	type PrHost,
	prHostTerms,
	prLabel,
} from "@prismalens/contracts";
import {
	ArchiveRestore,
	ArrowUpFromLine,
	FolderOpen,
	GitMerge,
	GitPullRequest,
	GitPullRequestCreate,
	PanelRightOpen,
	RefreshCw,
	SquareTerminal,
	Wrench,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import type { GitAction } from "./git-action";

/**
 * The thread's details card: its one git action and its openers. The git
 * actions put a request in the composer; the agent does the git work.
 */
export interface DetailsCtx {
	branch: string | null;
	/** The worktree's git state and what its git actions ask the agent. */
	git?: GitState | null;
	gitAsk?: string;
	/** Reads the diff and the change request's checks again. */
	reread?: () => void;
	/** The code host whose words name the PR or MR. */
	host: PrHost;
	pr?: { number: number; repo: string };
	ask: (text: string) => void;
	openPr: () => void;
	openFolder: () => void;
	openTerminal: () => void;
	facts: Facts<GitAction | "folder" | "terminal">;
}

/** The details object: the context its actions run with and the states they test. */
export const detailsObject = defineObject<
	DetailsCtx,
	GitAction | "folder" | "terminal"
>("details");

const branchOf = (c: DetailsCtx) =>
	c.branch ? `\`${c.branch}\`` : "this branch";
const prOf = (c: DetailsCtx) =>
	c.pr
		? `${prLabel(c.host, c.pr.number)} (${c.pr.repo})`
		: "the change request";

export const detailsPush = defineAction({
	id: "details.push",
	label: "Push",
	icon: ArrowUpFromLine,
	when: (f) => !!f.is?.push,
	run: (c) =>
		c.ask(
			`Commit the finished work on ${branchOf(c)} and push it to its remote.`,
		),
});

export const detailsCreatePr = defineAction({
	id: "details.createPr",
	label: (c) => `Create ${prHostTerms(c.host).short}`,
	icon: GitPullRequestCreate,
	when: (f) => !!f.is?.createPr,
	run: (c) =>
		c.ask(
			`Push ${branchOf(c)} and open a ${prHostTerms(c.host).changeRequest} for it. Title it from the change and give me its link.`,
		),
});

export const detailsFixChecks = defineAction({
	id: "details.fixChecks",
	label: (c) => `Fix ${prHostTerms(c.host).checks}`,
	icon: Wrench,
	when: (f) => !!f.is?.fixChecks,
	run: (c) =>
		c.ask(
			`${capitalTerm(prHostTerms(c.host).checks)} fail on ${prOf(c)}. Find the cause, fix it on this branch and push.`,
		),
});

export const detailsResolveConflicts = defineAction({
	id: "details.resolveConflicts",
	label: "Resolve conflicts",
	icon: GitMerge,
	when: (f) => !!f.is?.resolveConflicts,
	run: (c) =>
		c.ask(
			c.git?.state === "conflict" && c.gitAsk
				? c.gitAsk
				: `${prOf(c)} conflicts with its base. Merge the base into ${branchOf(c)}, resolve the conflicts, run the tests and push.`,
		),
});

export const detailsRestoreBranch = defineAction({
	id: "details.restoreBranch",
	label: "Restore branch",
	icon: ArchiveRestore,
	when: (f) => !!f.is?.restoreBranch,
	run: (c) => c.gitAsk && c.ask(c.gitAsk),
});

export const detailsReread = defineAction({
	id: "details.reread",
	label: "Re-read diff and checks",
	icon: RefreshCw,
	when: (f) => !!f.is?.reread,
	run: (c) => c.reread?.(),
});

export const detailsMarkReady = defineAction({
	id: "details.markReady",
	label: "Mark ready",
	icon: GitPullRequest,
	when: (f) => !!f.is?.markReady,
	run: (c) => c.ask(`Mark ${prOf(c)} ready for review.`),
});

export const detailsViewPr = defineAction({
	id: "details.viewPr",
	label: (c) => `View ${prHostTerms(c.host).short}`,
	icon: PanelRightOpen,
	when: (f) => !!f.is?.viewPr,
	run: (c) => c.openPr(),
});

export const detailsOpenFolder = defineAction({
	id: "details.openFolder",
	label: "Open folder",
	icon: FolderOpen,
	when: (f) => !!f.is?.folder,
	run: (c) => c.openFolder(),
});

export const detailsOpenTerminal = defineAction({
	id: "details.openTerminal",
	label: "Terminal",
	icon: SquareTerminal,
	when: (f) => !!f.is?.terminal,
	run: (c) => c.openTerminal(),
});
