// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	capitalTerm,
	type EditorId,
	type GitState,
	type PrHost,
	prHostTerms,
	prLabel,
} from "@prismalens/contracts";
import {
	ArchiveRestore,
	ArrowUpFromLine,
	FileCodeCorner,
	FolderOpen,
	GitBranchPlus,
	GitMerge,
	GitPullRequest,
	GitPullRequestCreate,
	Lock,
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

/** Where the folder opens: an editor on this computer's PATH, or its file manager. */
export type EditorChoice = EditorId | "system";
type DetailsState =
	| GitAction
	| "folder"
	| "terminal"
	| "notOwner"
	| `has.${EditorId}`;

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
	/** The branch a detached worktree takes, and whether it can then be pushed (#1176 F2). */
	newBranch?: { name: string; pushable: boolean };
	/** Opens the folder on the host: in an editor, its file manager, or its saved default. */
	opener?: {
		os: "windows" | "macos" | "linux" | "other";
		owner: boolean;
		open: (e?: EditorChoice) => void;
	};
	/** Set by the folder split once it has read the editors and the default (#1176). */
	editor?: { current: EditorChoice; label: (e: EditorChoice) => string };
	openIn?: (e: EditorChoice) => void;
	facts: Facts<DetailsState>;
}

/** The details object: the context its actions run with and the states they test. */
export const detailsObject = defineObject<DetailsCtx, DetailsState>("details");

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

export const detailsBranchAndPush = defineAction({
	id: "details.branchAndPush",
	label: (c) =>
		c.newBranch?.pushable ? "Create branch and push" : "Create branch",
	icon: GitBranchPlus,
	when: (f) => !!f.is?.branchAndPush,
	run: (c) => {
		const b = c.newBranch;
		if (b) void import("./branch-ask").then((m) => c.ask(m.branchAsk(b)));
	},
});

const openInLabel = (c: DetailsCtx, e: EditorChoice) => c.editor?.label(e) ?? e;

export const detailsOpenFolder = defineAction({
	id: "details.openFolder",
	label: (c) =>
		c.editor ? `Open in ${openInLabel(c, c.editor.current)}` : "Open folder",
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

/** One opener row: shown when the host has it, ticked when it is the default (#1176). */
const openIn = (e: EditorChoice) => {
	const has: DetailsState = e === "system" ? "folder" : `has.${e}`;
	return {
		label: (c: DetailsCtx) => openInLabel(c, e),
		icon: e === "system" ? FolderOpen : FileCodeCorner,
		when: (f: Facts<DetailsState>) => !!f.is?.folder && !!f.is?.[has],
		checked: (c: DetailsCtx) => c.editor?.current === e,
		run: (c: DetailsCtx) => c.openIn?.(e),
	};
};

export const detailsOpenInVscode = defineAction({
	id: "details.openIn.vscode",
	...openIn("vscode"),
});
export const detailsOpenInCursor = defineAction({
	id: "details.openIn.cursor",
	...openIn("cursor"),
});
export const detailsOpenInZed = defineAction({
	id: "details.openIn.zed",
	...openIn("zed"),
});
export const detailsOpenInJetbrains = defineAction({
	id: "details.openIn.jetbrains",
	...openIn("jetbrains"),
});
export const detailsOpenInSublime = defineAction({
	id: "details.openIn.sublime",
	...openIn("sublime"),
});
export const detailsOpenInSystem = defineAction({
	id: "details.openIn.system",
	...openIn("system"),
});

/** A non-owner's pick opens without saving; the menu says whose default it is (#1176). */
export const detailsOwnerDefault = defineAction({
	id: "details.ownerDefault",
	label: "Default set by the owner",
	icon: Lock,
	when: (f) => !!f.is?.folder && !!f.is?.notOwner,
	disabled: () => true,
	run: () => undefined,
});
