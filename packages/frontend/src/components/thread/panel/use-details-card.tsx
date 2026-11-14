// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PullRequest,
	RunWorkspace,
	ThreadContext,
	ThreadLink,
} from "@prismalens/contracts";
import type { ReactElement } from "react";
import { Surface } from "@/components/kit/Surface";
import { toast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { compose } from "@/lib/compose";
import { lazyPart } from "@/lib/lazy";
import { gitAsk } from "../git/git-state";
import { DetailsStarted, startedSpan } from "./DetailsStarted";
import type { DetailsCtx } from "./details.actions";
import { branchPr, gitAction, hostOfUrl } from "./git-action";

// The card's actions read the registry; they load with the card (#1101 category 12).
const DetailsActions = lazyPart(() =>
	import("./DetailsActions").then((m) => m.DetailsActions),
);

/**
 * The details card's live parts: its one git action, the folder and terminal
 * openers, and the surface that gives them to right-click and the palette.
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
	/** The panel's full list of started threads. */
	openStarted: () => void;
	/** Keeps the sidebar to the threads this one started (`?by=`). */
	filterStarted: () => void;
	/** Reads the diff and the change request's checks again. */
	reread?: () => void;
}) {
	const { context, workspace } = o;
	const repos = context?.workspace?.repos ?? [];
	const repo = repos.find((r) => r.branch);
	const prs = o.pulls?.pullRequests ?? context?.pullRequests ?? [];
	const branch = repo?.branch ?? null;
	const own = branchPr(prs, branch);
	const primary = context
		? gitAction({
				layout: context.workspace?.layout ?? null,
				branch,
				ahead: repo?.ahead ?? null,
				changed:
					repo && repo.additions !== null && repo.deletions !== null
						? repo.additions + repo.deletions > 0
						: null,
				pullRequests: prs,
				lookedUp: !!o.pulls?.statusEnabled,
				git: context.git?.state ?? null,
			})
		: null;
	const folder = !!context?.workspace && !!context.machine.isHost;
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
		openFolder: () =>
			void orpc.runWorkspaces.openInEditor
				.call({ id: o.threadId, editor: "system" })
				.then((r) =>
					r.opened ? null : toast({ title: "The folder did not open" }),
				)
				.catch(() => toast({ title: "Opens only on the host" })),
		openTerminal: o.openTerminal,
		facts: {
			is: {
				...(primary ? { [primary]: true } : {}),
				folder,
				terminal: folder && o.terminal,
			},
		},
	};
	const actions =
		primary || folder ? (
			<DetailsActions ctx={ctx} primary={primary} />
		) : undefined;
	const started = (list: ThreadLink[]) => ({
		node: (
			<DetailsStarted
				started={list}
				onFilter={o.filterStarted}
				onMore={o.openStarted}
			/>
		),
		span: startedSpan(list.length),
	});
	/** The card inside its registered surface; the transcript beside it is not part of it. */
	const wrap = (card: ReactElement) => (
		<Surface id="thread.details" ctx={ctx}>
			<div>{card}</div>
		</Surface>
	);
	return { actions, started, wrap, primary, ctx };
}
