// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	capitalTerm,
	type FixItem,
	type FixPlace,
	type FixPreview,
	type FixRefusal,
	type PrHostTerms,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { linkStates } from "@/components/investigation/transcript/link-states";
import { isConflict } from "@/components/investigation/useInvestigationRun";
import { Status } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { Loading, Problem } from "@/components/shared/State";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useFixPreview,
	useStartFixThread,
} from "@/lib/api/hooks/use-fix-thread";

/** Why a fix thread can't start, in a few words; the server's detail is the hover. */
export const REFUSAL_WORD: Record<FixRefusal, string> = {
	"no-project": "No project for this repo",
	"plain-folder": "Project isn't a git repo",
	"fork-branch": "Branch is in a fork",
	"no-head": "No head commit yet",
	closed: "Not open",
	"missing-commit": "Head commit not here",
	"not-failing": "Not failing anymore",
	cancelled: "It was cancelled",
	resolved: "Already resolved",
	"status-off": "Pull request status is off",
};

const PUSH_NOTE: Record<
	NonNullable<FixPlace["pushNote"]>,
	[word: string, hover: string]
> = {
	clone: [
		"Commits, doesn't push",
		"This project is a copy, so the thread can't push to the branch. It says the commit so you can push it.",
	],
	"push-elsewhere": [
		"Commits, doesn't push",
		"The project's remote doesn't push to this repository, so the thread commits and stops.",
	],
	"unsafe-ref": [
		"Commits, doesn't push",
		"The branch name can't be passed to git safely, so the thread commits and stops.",
	],
};

const ROW = "flex min-w-0 items-baseline gap-2 text-body";
const KEY = "w-20 shrink-0 text-meta text-text-3";

function PlaceRows({ place }: { place: FixPlace }) {
	const sha7 = place.headSha.slice(0, 7);
	const agent = [place.harness, place.model, place.effort]
		.filter(Boolean)
		.join(", ");
	const note = place.pushNote ? PUSH_NOTE[place.pushNote] : null;
	return (
		<div className="flex flex-col gap-1" data-testid="fix-place">
			<p className={ROW}>
				<span className={KEY}>Project</span>
				<span className="min-w-0 truncate text-text-1">
					{place.projectName}
				</span>
			</p>
			<p className={ROW}>
				<span className={KEY}>Starts at</span>
				<span className="min-w-0 truncate font-mono text-mono text-text-1">
					{place.headRef} {sha7}
				</span>
			</p>
			{place.fetch && (
				<p className={ROW} data-testid="fix-place-fetch">
					<span className={KEY}>First</span>
					<Hint label="The head commit isn't in the folder yet; Start fetches the branch from origin.">
						<span className="min-w-0 truncate text-text-1">
							Fetches {place.headRef}
						</span>
					</Hint>
				</p>
			)}
			<p className={ROW} data-testid="fix-place-push" data-push={place.push}>
				<span className={KEY}>Push</span>
				{place.push === "branch" ? (
					<Hint label={place.pushUrl ?? ""}>
						<span className="min-w-0 truncate text-text-1">
							To {place.headRef}
							{place.pushUrl && (
								<span className="text-text-3"> on {place.pushUrl}</span>
							)}
						</span>
					</Hint>
				) : (
					<Hint label={note?.[1] ?? "The thread commits and stops."}>
						<span className="min-w-0 truncate text-text-1">
							{note?.[0] ?? "Commits, doesn't push"}
						</span>
					</Hint>
				)}
			</p>
			{agent && (
				<p className={ROW}>
					<span className={KEY}>Agent</span>
					<span className="min-w-0 truncate text-text-1">{agent}</span>
				</p>
			)}
		</div>
	);
}

/** The preview's body: what Start would send, where it runs, and why it can't when it can't. */
export function FixPreviewBody({ preview }: { preview: FixPreview }) {
	return (
		<div className="flex min-w-0 flex-col gap-3">
			{preview.refusal && (
				<Hint label={preview.refusal.detail}>
					<p
						className="m-0 text-body text-text-1"
						data-testid="fix-refusal"
						data-reason={preview.refusal.reason}
					>
						<Status kind="failed" word={REFUSAL_WORD[preview.refusal.reason]} />
					</p>
				</Hint>
			)}
			{preview.items.length > 0 && (
				<ul
					className="m-0 flex list-none flex-col gap-0.5 p-0"
					data-testid="fix-items"
				>
					{preview.items.map((i) => (
						<li
							key={i.ident}
							className="truncate text-body text-text-1"
							data-testid="fix-item"
							data-ident={i.ident}
						>
							{i.label}
						</li>
					))}
				</ul>
			)}
			{preview.covered.length > 0 && (
				<ul
					className="m-0 flex list-none flex-col gap-0.5 p-0"
					data-testid="fix-covered"
				>
					{preview.covered.map((c) => (
						<li
							key={c.ident}
							className="flex min-w-0 items-center gap-2 text-body"
							data-testid="fix-covered-row"
						>
							<span className="min-w-0 flex-1 truncate text-text-2">
								{c.label}
							</span>
							<Link
								to="/threads/$id"
								params={{ id: c.link.id }}
								className="shrink-0 text-meta text-text-2 hover:text-text-1"
							>
								<Status
									kind={c.link.status ?? linkStates.get(c.link.state).status}
									word="Has a thread"
									fact={null}
								/>
							</Link>
						</li>
					))}
				</ul>
			)}
			{preview.place && <PlaceRows place={preview.place} />}
			{preview.text && (
				<section aria-label="Message" className="flex flex-col gap-1">
					<p className="m-0 text-meta text-text-3">Message</p>
					<pre
						className="m-0 max-h-48 overflow-y-auto rounded-control bg-surface-2 p-2 font-mono text-mono break-words whitespace-pre-wrap text-text-1"
						data-testid="fix-text"
					>
						{preview.text}
					</pre>
				</section>
			)}
			{preview.evidence && (
				<details className="group" data-testid="fix-evidence">
					<summary className="cursor-pointer text-meta text-text-2 hover:text-text-1">
						What the host reported
					</summary>
					<pre className="m-0 mt-1 max-h-64 overflow-y-auto rounded-control bg-surface-2 p-2 font-mono text-mono break-words whitespace-pre-wrap text-text-2">
						{preview.evidence}
					</pre>
				</details>
			)}
		</div>
	);
}

/**
 * Previews a new thread that fixes checks or review comments, then starts exactly that
 * (#1176 D7): a changed preview answers CONFLICT, and the dialog reads it again.
 */
export function FixThreadDialog({
	threadId,
	prId,
	items,
	onClose,
}: {
	threadId: string;
	prId: string;
	items: FixItem[];
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const preview = useFixPreview(threadId, prId, items);
	const start = useStartFixThread();
	const [changed, setChanged] = useState(false);
	const p = preview.data;
	const canStart =
		!!p && p.refusal === null && p.items.length >= 1 && !!p.digest;
	const goTo = p && p.items.length === 0 && p.covered[0]?.link;
	const send = () => {
		if (!p?.digest) return;
		setChanged(false);
		start.mutate(
			{ id: threadId, prId, items, digest: p.digest },
			{
				onSuccess: (r) => {
					onClose();
					void navigate({
						to: "/threads/$id",
						params: { id: r.investigationId },
					});
				},
				onError: (e) => {
					if (!isConflict(e)) return;
					setChanged(true);
					start.reset();
					void preview.refetch();
				},
			},
		);
	};
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent size="lg" data-testid="fix-dialog">
				<DialogHeader>
					<DialogTitle data-testid="fix-title">
						{p?.title ?? "Fix in a new thread"}
					</DialogTitle>
					<DialogDescription>
						A new thread on the branch's head. Nothing starts until you press
						Start.
					</DialogDescription>
				</DialogHeader>
				{preview.isLoading ? (
					<Loading rows={4} />
				) : preview.error && !p ? (
					<Problem
						text="Preview didn't load"
						onRetry={() => void preview.refetch()}
					/>
				) : (
					p && <FixPreviewBody preview={p} />
				)}
				{changed && (
					<p className="m-0 text-body text-text-1" data-testid="fix-changed">
						It changed; review again
					</p>
				)}
				{start.error && !isConflict(start.error) && (
					<Problem text="Thread didn't start" onRetry={send} />
				)}
				<DialogFooter>
					<Button variant="text" onClick={onClose}>
						Cancel
					</Button>
					{goTo ? (
						<Button variant="primary" asChild>
							<Link
								to="/threads/$id"
								params={{ id: goTo.id }}
								onClick={onClose}
								data-testid="fix-go-to"
							>
								Go to thread
							</Link>
						</Button>
					) : (
						<Button
							variant="primary"
							disabled={!canStart || start.isPending || preview.isFetching}
							onClick={send}
							data-testid="fix-start"
						>
							Start
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Asks before a re-run (#1176 D9): it runs the check, and what depends on it, again. */
export function RerunConfirm({
	name,
	sha,
	terms,
	onConfirm,
	onClose,
}: {
	name: string;
	sha: string | null;
	terms: PrHostTerms;
	onConfirm: () => void;
	onClose: () => void;
}) {
	return (
		<AlertDialog open onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent data-testid="rerun-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Re-run {name}?</AlertDialogTitle>
					<AlertDialogDescription>
						Runs the {terms.check} again
						{sha ? ` on ${sha.slice(0, 7)}` : ""}. {capitalTerm(terms.checks)}{" "}
						that depend on it run again too.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel data-testid="rerun-cancel">
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} data-testid="rerun-confirm">
						Re-run
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
