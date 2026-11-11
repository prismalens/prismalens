// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, Proposal } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useThreadContext } from "@/lib/api/hooks/use-thread-context-orpc";
import { useResolveProposal } from "@/lib/api/hooks/use-thread-tree-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";
import type { TranscriptNodeProps } from "./types";

type Ev<K extends CanonicalEvent["kind"]> = Extract<
	CanonicalEvent,
	{ kind: K }
>;

const LINE = "text-meta text-text-2";
const THREAD_LINK = "text-accent hover:underline";

function ChildLink({ id, children }: { id: string; children: string }) {
	return (
		<Link to="/threads/$id" params={{ id }} className={THREAD_LINK}>
			{children}
		</Link>
	);
}

export function ThreadStartedNode({ event }: TranscriptNodeProps) {
	const e = event as Ev<"thread_started">;
	return (
		<p className={LINE} data-testid="tree-started">
			Started <ChildLink id={e.childId}>{e.title}</ChildLink>
			<span className="text-text-3"> · {e.role}</span>
		</p>
	);
}

/** One line per message; the operator message that carried it is folded in (investigation-events). */
export function ThreadMessageNode({ event }: TranscriptNodeProps) {
	const e = event as Ev<"thread_message">;
	const peer = e.peerLink.split("/").pop() ?? e.peerId;
	return (
		<p className={cn(LINE, "truncate")} data-testid="tree-message">
			{e.direction === "sent" ? "To " : "From "}
			<ChildLink id={peer}>{e.peerRole}</ChildLink>: {e.text}
		</p>
	);
}

const OUTCOME: Record<Ev<"child_finished">["outcome"], string> = {
	answered: "answered",
	failed: "failed",
	stopped: "was stopped",
	limited: "hit a usage limit",
};

export function ChildFinishedNode({ event }: TranscriptNodeProps) {
	const e = event as Ev<"child_finished">;
	return (
		<div className="flex flex-col gap-0.5" data-testid="tree-finished">
			<p className={LINE}>
				<ChildLink id={e.childId}>{e.role}</ChildLink> {OUTCOME[e.outcome]}
			</p>
			{e.excerpt && (
				<p className="line-clamp-3 text-meta text-text-3">{e.excerpt}</p>
			)}
		</div>
	);
}

/** What one proposal would change, in a line. */
export function proposalLine(p: Proposal): string {
	const c = p.change;
	switch (c.kind) {
		case "setting":
			return `Set ${c.key} to ${c.value}`;
		case "schedule":
			return `Schedule "${c.name}" (${c.cron}, ${c.timezone})`;
		case "service_link":
			return "Link a service to a project";
		case "project_add":
			return `Add the project ${c.source}`;
	}
}

/** The agent's proposal: nothing changes until the host applies it. */
export function ProposalNode({ event }: TranscriptNodeProps) {
	const { proposal } = event as Ev<"action_proposed">;
	const context = useThreadContext(proposal.threadId);
	const { apply, dismiss } = useResolveProposal();
	const [state, setState] = useState(proposal.state);
	const [error, setError] = useState<string | null>(null);
	const isHost = !!context.data?.machine.isHost;
	const resolve = (how: "apply" | "dismiss") => {
		setError(null);
		(how === "apply" ? apply : dismiss).mutate(
			{ id: proposal.threadId, pid: proposal.id },
			{
				onSuccess: (p) => setState(p.state),
				onError: (e) => setError(getErrorMessage(e)),
			},
		);
	};
	const busy = apply.isPending || dismiss.isPending;
	return (
		<div
			className="flex flex-col gap-1.5 rounded-surface bg-surface-1 px-3 py-2"
			data-testid="tree-proposal"
			data-state={state}
		>
			<p className="text-body text-text-1">{proposalLine(proposal)}</p>
			{proposal.why && <p className="text-meta text-text-2">{proposal.why}</p>}
			{state === "open" ? (
				isHost ? (
					<div className="flex gap-2">
						<Button size="sm" disabled={busy} onClick={() => resolve("apply")}>
							Apply
						</Button>
						<Button
							size="sm"
							variant="text"
							disabled={busy}
							onClick={() => resolve("dismiss")}
						>
							Dismiss
						</Button>
					</div>
				) : (
					<p className="text-meta text-text-3">
						Apply it on the computer PrismaLens runs on.
					</p>
				)
			) : (
				<p className="text-meta text-text-3">
					{state === "applied"
						? "Applied"
						: state === "dismissed"
							? "Dismissed"
							: "Applying"}
				</p>
			)}
			{error && (
				<p className="text-meta text-danger" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

export function ProposalResolvedNode({ event }: TranscriptNodeProps) {
	const e = event as Ev<"action_resolved">;
	return (
		<p className={LINE} data-testid="tree-proposal-resolved">
			{e.state === "applied"
				? "You applied the proposal"
				: e.state === "dismissed"
					? "You dismissed the proposal"
					: "Applying the proposal"}
		</p>
	);
}
