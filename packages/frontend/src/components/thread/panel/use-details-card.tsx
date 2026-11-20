// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PullRequest,
	RunWorkspace,
	ThreadContext,
} from "@prismalens/contracts";
import type { ReactElement } from "react";
import { Surface } from "@/components/kit/Surface";
import { toast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { compose } from "@/lib/compose";
import { lazyPart } from "@/lib/lazy";
import { gitAsk } from "../git/git-state";
import type { DetailsCtx, EditorChoice } from "./details.actions";
import { branchPr, gitAction, hostOfUrl } from "./git-action";

// The card's actions read the registry; they load with the card (#1101 category 12).
const DetailsActions = lazyPart(() =>
	import("./DetailsActions").then((m) => m.DetailsActions),
);
const DetailsFolder = lazyPart(() =>
	import("./DetailsActions").then((m) => m.DetailsFolder),
);

/**
 * The box's live parts: its one git action, the folder opener with the terminal
 * behind it, and the surface that gives them to right-click and the palette.
 */
export function useDetailsCard(o: {
	threadId: string;
	context: ThreadContext | undefined;
	workspace: RunWorkspace | null | undefined;
	/** The panel's PR list once read, with whether the branch was looked up. */
	pulls: { pullRequests: PullRequest[]; statusEnabled: boolean } | undefined;
	terminal: boolean;
	openPr: (pr: PullRequest | undefined) => void;
	openTerminal: () => void;
	/** Reads the diff and the change request's checks again. */
	reread?: () => void;
}) {
	const { context, workspace } = o;
	const repos = context?.workspace?.repos ?? [];
	const repo = repos.find((r) => r.branch);
	// A detached worktree has no branch row to act on; its own repo carries the action (#1176 F2).
	const loose = repo ? undefined : repos.find((r) => r.detached);
	const work = repo ?? loose;
	const prs = o.pulls?.pullRequests ?? context?.pullRequests ?? [];
	const branch = repo?.branch ?? null;
	const own = branchPr(prs, branch);
	const primary = context
		? gitAction({
				layout: context.workspace?.layout ?? null,
				branch,
				ahead: repo?.ahead ?? null,
				changed:
					work && work.additions !== null && work.deletions !== null
						? work.additions + work.deletions > 0
						: null,
				pullRequests: prs,
				lookedUp: !!o.pulls?.statusEnabled,
				git: context.git?.state ?? null,
				// A detached worktree with no name to offer has no branch action.
				detached: !!loose && !!context.workspace?.suggestedBranch,
				moved: !!loose?.tip && loose.tip !== loose.head,
			})
		: null;
	const folder = !!context?.workspace && !!context.machine.isHost;
	// Without an editor the host opens its saved default; the split names and changes it.
	const open = (editor?: EditorChoice) =>
		void orpc.runWorkspaces.openInEditor
			.call({ id: o.threadId, ...(editor ? { editor } : {}) })
			.then((r) =>
				r.opened ? null : toast({ title: "The folder did not open" }),
			)
			.catch(() => toast({ title: "Opens only on the host" }));
	const ctx: DetailsCtx = {
		branch:
			branch ??
			(context?.git && "branch" in context.git ? context.git.branch : null),
		git: context?.git ?? null,
		...(context?.git ? { gitAsk: gitAsk(context.git) } : {}),
		...(o.reread ? { reread: o.reread } : {}),
		host:
			own?.host ??
			hostOfUrl(workspace?.repos.find((r) => r.sourceKind === "url")?.url),
		...(own ? { pr: { number: own.number, repo: own.repo } } : {}),
		ask: compose,
		openPr: () => o.openPr(own),
		openFolder: () => open(),
		openTerminal: o.openTerminal,
		...(loose && context?.workspace?.suggestedBranch
			? {
					newBranch: {
						name: context.workspace.suggestedBranch,
						pushable: !!loose.pushable,
					},
				}
			: {}),
		...(context
			? {
					opener: {
						os: context.machine.os,
						owner: !!context.machine.isOwner,
						open,
					},
				}
			: {}),
		facts: {
			is: {
				...(primary ? { [primary]: true } : {}),
				folder,
				terminal: folder && o.terminal,
			},
		},
	};
	const actions = primary ? (
		<DetailsActions ctx={ctx} primary={primary} />
	) : undefined;
	const folderOpener = folder ? <DetailsFolder ctx={ctx} /> : undefined;
	/** The card inside its registered surface; the transcript beside it is not part of it. */
	const wrap = (card: ReactElement) => (
		<Surface id="thread.details" ctx={ctx}>
			<div>{card}</div>
		</Surface>
	);
	return { actions, folder: folderOpener, wrap, primary, ctx };
}
