// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RewindPreview,
	RewindRepoPreview,
	RewindRestorePreview,
} from "@prismalens/contracts";
import { REWIND_BLOCK_WORDS } from "@prismalens/contracts";
import { type ReactNode, useId, useState } from "react";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { useFilePatch } from "@/components/thread/diff/use-scoped-changes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/get-error-message";
import {
	type RewindTarget,
	rewindRefusalWords,
	rewoundWords,
	useRestorePreview,
	useRewindCalls,
	useRewindPreview,
} from "./use-rewind";

/** The accepted residuals, worded as the operator ruled (#1193 seam 3, R4 and R5). */
export const REWIND_SMALL_PRINT = [
	"If an editor or process saves a file after its final safety check but before rewind, Undo, or Restore overwrites or deletes it, that save may be lost and may not be in the backup.",
	"Undo and Restore may normalize mixed or noncanonical line endings to the checkout format; they do not promise byte-for-byte recovery.",
];

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const KEEP_WORDS: Record<string, string> = {
	yours: "you changed it",
	both: "you and the agent both changed it",
	linked: "a link is in its path",
};

const UNAVAILABLE_WORDS: Record<string, string> = {
	borrowed: "works in your own checkout, so its files stay",
	folder: "is a plain folder with no history, so its files stay",
	running: "is still being written",
	"view-only": "can't be changed from this device",
	"no-snapshot": "has no snapshot from before this message, so its files stay",
	removed: "was removed",
	linked: "has a link in a file's path, so its files stay",
	"too-many": "changed too many files to list here, so its files stay",
};

const SESSION_WORDS: Record<RewindPreview["session"]["via"], string> = {
	fork: "The agent's session is cut back to this message.",
	replay: "A new session starts with the conversation up to this message.",
	new: "A new session starts with this message.",
};

function SmallPrint() {
	return (
		<div
			className="space-y-1 text-meta text-text-3"
			data-testid="rewind-small-print"
		>
			{REWIND_SMALL_PRINT.map((line) => (
				<p key={line}>{line}</p>
			))}
		</div>
	);
}

/** One line per fact, with the paths after a colon (#1193 spec, Frontend 3). */
function Fact({ testid, children }: { testid: string; children: ReactNode }) {
	return (
		<li data-testid={testid} className="break-words">
			{children}
		</li>
	);
}

function pathsOf<T>(
	repos: RewindRepoPreview[],
	pick: (r: Extract<RewindRepoPreview, { state: "ok" }>) => T[],
	words: (t: T) => string,
): string[] {
	const ok = repos.filter(
		(r): r is Extract<RewindRepoPreview, { state: "ok" }> => r.state === "ok",
	);
	const many = repos.length > 1;
	return ok.flatMap((r) =>
		pick(r).map((t) => (many ? `${r.repo}: ${words(t)}` : words(t))),
	);
}

/** The edit's preview: what folds, goes back, stays, and how the session continues. */
export function RewindEditFacts({
	preview,
	include,
	setInclude,
}: {
	preview: RewindPreview;
	include: boolean;
	setInclude: (on: boolean) => void;
}) {
	const back = pathsOf(
		preview.repos,
		(r) => r.revert,
		(p) => p.path,
	);
	const kept = pathsOf(
		preview.repos,
		(r) => r.kept,
		(k) => `${k.path} (${KEEP_WORDS[k.why] ?? k.why})`,
	);
	const during = pathsOf(
		preview.repos,
		(r) => r.duringTurn,
		(p) => p,
	);
	const commits = preview.repos.reduce(
		(n, r) => n + (r.state === "ok" ? r.commits : 0),
		0,
	);
	const stays = [
		...preview.stays,
		...(commits > 0 ? [`${plural(commits, "commit")} on the branch`] : []),
	];
	const unavailable = preview.repos.filter((r) => r.state === "unavailable");
	const boxId = useId();
	return (
		<ul>
			<Fact testid="rewind-turns">
				Folds {plural(preview.turns, "turn")} after this message. You can show
				or restore them.
			</Fact>
			{back.length > 0 && (
				<Fact testid="rewind-revert">
					Sets {plural(back.length, "file")} back: {back.join(", ")}
				</Fact>
			)}
			{kept.length > 0 && (
				<Fact testid="rewind-kept">
					Keeps {plural(kept.length, "file")}: {kept.join(", ")}
				</Fact>
			)}
			{during.length > 0 && (
				<Fact testid="rewind-during">
					<span>
						Changed during the agent's turn but not by its edits:{" "}
						{during.join(", ")}
					</span>
					<span className="mt-1 flex items-center gap-2">
						<Checkbox
							id={boxId}
							checked={include}
							onCheckedChange={(v) => setInclude(v === true)}
							data-testid="rewind-during-include"
						/>
						<label htmlFor={boxId}>Set these back too</label>
					</span>
				</Fact>
			)}
			{unavailable.map((r) => (
				<Fact key={r.repo} testid="rewind-unavailable">
					{r.repo} {UNAVAILABLE_WORDS[r.reason] ?? "stays as it is"}
				</Fact>
			))}
			{stays.length > 0 && (
				<Fact testid="rewind-stays">Stays: {stays.join(", ")}</Fact>
			)}
			<Fact testid="rewind-session">
				{SESSION_WORDS[preview.session.via]}
				{preview.session.why &&
					` It can't cut the session: ${preview.session.why}.`}
			</Fact>
		</ul>
	);
}

/** One path's backup against the files now: what Restore would write back. */
function BackupDiff({
	threadId,
	preview,
	path,
}: {
	threadId: string;
	preview: RewindRestorePreview;
	path: string;
}) {
	const patch = useFilePatch(
		threadId,
		preview.repo,
		{ from: preview.now, to: preview.backup },
		path,
		true,
	);
	if (patch.isPending) return <p className="text-meta text-text-3">Loading</p>;
	if (patch.data?.state !== "ok")
		return <p className="text-meta text-text-3">No diff to show</p>;
	return (
		<pre className="max-h-48 overflow-auto rounded-control bg-surface-2 p-2 font-mono text-meta text-text-2">
			{patch.data.patch || "No difference"}
		</pre>
	);
}

/** An interrupted operation's restore: what goes back, what stays unless ticked. */
export function RestoreFacts({
	threadId,
	preview,
	include,
	setInclude,
}: {
	threadId: string;
	preview: RewindRestorePreview;
	include: ReadonlySet<string>;
	setInclude: (paths: Set<string>) => void;
}) {
	const [shown, setShown] = useState<string | null>(null);
	const toggle = (p: string, on: boolean) => {
		const next = new Set(include);
		if (on) next.add(p);
		else next.delete(p);
		setInclude(next);
	};
	const row = (p: string, tickable: boolean) => (
		<li key={p} className="space-y-1">
			<span className="flex items-center gap-2">
				{tickable && (
					<Checkbox
						checked={include.has(p)}
						onCheckedChange={(v) => toggle(p, v === true)}
						aria-label={`Restore ${p} too`}
					/>
				)}
				<span className="min-w-0 flex-1 break-all font-mono text-meta">
					{p}
				</span>
				<Button
					variant="text"
					size="xs"
					onClick={() => setShown(shown === p ? null : p)}
					data-testid="rewind-show-backup"
				>
					{shown === p ? "Hide" : "Show backup"}
				</Button>
			</span>
			{shown === p && (
				<BackupDiff threadId={threadId} preview={preview} path={p} />
			)}
		</li>
	);
	return (
		<div className="space-y-2" data-testid="rewind-restore-preview">
			{preview.overwrite.length > 0 && (
				<>
					<p>
						Sets {plural(preview.overwrite.length, "file")} back to the backup
					</p>
					<ul>{preview.overwrite.map((p) => row(p, false))}</ul>
				</>
			)}
			{preview.created.length > 0 && (
				<>
					<p>Not in the backup, kept unless ticked:</p>
					<ul>{preview.created.map((p) => row(p, true))}</ul>
				</>
			)}
			{preview.damaged.length > 0 && (
				<>
					<p>Changed since, restored only if ticked:</p>
					<ul>{preview.damaged.map((p) => row(p, true))}</ul>
				</>
			)}
			{!preview.overwrite.length &&
				!preview.created.length &&
				!preview.damaged.length && <p>The files already match the backup.</p>}
		</div>
	);
}

class Refused extends Error {}

/**
 * The preview as first shown. A refetch waits behind a "changed" line until the user takes it,
 * so a confirm, its ticks and its consent bind to what the user saw (#1193).
 */
function useShown<T>(live: T | undefined) {
	const [shown, setShown] = useState<T | undefined>(live);
	if (shown === undefined && live !== undefined) setShown(live);
	const changed =
		shown !== undefined &&
		live !== undefined &&
		JSON.stringify(live) !== JSON.stringify(shown);
	return { shown, changed, take: () => setShown(live) };
}

function Changed({ what, onTake }: { what: string; onTake: () => void }) {
	return (
		<p className="text-meta text-warn" data-testid="rewind-changed">
			{what} changed since this was shown.{" "}
			<Button
				variant="text"
				size="xs"
				onClick={onTake}
				data-testid="rewind-changed-show"
			>
				Show what it would do now
			</Button>
		</p>
	);
}

/**
 * The one confirm for edit, undo and restore (#1193): fresh preview, the facts one per line,
 * the accepted residuals as small print.
 */
export function RewindDialog(
	props: DialogProps & { target: RewindTarget | null },
) {
	return props.target ? <OpenDialog {...props} target={props.target} /> : null;
}

interface DialogProps {
	threadId: string;
	onClose: () => void;
	/** A rewind that ran but whose message was not admitted: its text goes back in the composer. */
	onKept: (kept: { text: string; why: string }) => void;
}

function OpenDialog({
	threadId,
	target,
	onClose,
	onKept,
}: DialogProps & { target: RewindTarget }) {
	const edit = target?.mode === "edit" ? target : null;
	const restore = target?.mode === "restore" ? target : null;
	const preview = useRewindPreview(threadId, edit?.seq ?? null);
	const restorePreview = useRestorePreview(threadId, restore?.op ?? null);
	const calls = useRewindCalls(threadId);
	const [during, setDuring] = useState(false);
	const [ticked, setTicked] = useState<Set<string>>(new Set());
	const editShown = useShown(preview.data);
	const restoreShown = useShown(restorePreview.data);

	const close = (open: boolean) => {
		if (open) return;
		setDuring(false);
		setTicked(new Set());
		onClose();
	};

	const undoNow = (rewindId: string) =>
		calls.undo.mutateAsync({ id: threadId, rewindId }).then(
			(r) =>
				toast(
					r.state === "done"
						? {
								title: "Edit undone",
								description: `${plural(r.restored.length, "file")} restored, ${r.kept.length} kept`,
							}
						: {
								title: "Not undone",
								description: rewindRefusalWords(r),
								variant: "destructive",
							},
				),
			(e: unknown) =>
				toast({
					title: "Not undone",
					description: getErrorMessage(e),
					variant: "destructive",
				}),
		);

	const confirmEdit = async () => {
		const p = editShown.shown;
		if (!edit || !p) return;
		const repos = Object.fromEntries(
			p.repos.flatMap((r) =>
				r.state === "ok" ? [[r.repo, { head: r.head, tree: r.tree }]] : [],
			),
		);
		const include = during
			? p.repos.flatMap((r) =>
					r.state === "ok"
						? r.duringTurn.map((path) => ({ repo: r.repo, path }))
						: [],
				)
			: [];
		const r = await calls.rewind.mutateAsync({
			id: threadId,
			seq: edit.seq,
			text: edit.text,
			expect: { messageOrdinal: p.messageOrdinal, revision: p.revision, repos },
			include,
		});
		if (r.state === "refused") throw new Refused(rewindRefusalWords(r));
		if (!r.sent) onKept({ text: edit.text, why: r.why ?? "It was not sent." });
		toast({
			title: rewoundWords(r.reverted.length, r.kept.length),
			action: (
				<ToastAction
					altText="Undo the edit"
					onClick={() => void undoNow(r.rewindId)}
				>
					Undo
				</ToastAction>
			),
		});
	};

	const confirmUndo = async () => {
		if (target?.mode !== "undo") return;
		const r = await calls.undo.mutateAsync({
			id: threadId,
			rewindId: target.rewindId,
		});
		if (r.state === "refused") throw new Refused(rewindRefusalWords(r));
		toast({
			title: "Edit undone",
			description: `${plural(r.restored.length, "file")} restored, ${r.kept.length} kept`,
		});
	};

	const confirmRestore = async () => {
		const p = restoreShown.shown;
		if (!restore || !p) return;
		const r = await calls.restore.mutateAsync({
			id: threadId,
			op: restore.op,
			expect: { head: p.head, tree: p.tree },
			include: Array.from(ticked),
		});
		if (r.state === "refused")
			throw new Refused(
				r.reason === "gone"
					? "The backup is gone, so nothing was restored."
					: r.reason === "stale"
						? "The files changed since this was shown. Open it again to see what it would do now."
						: r.reason === "running"
							? REWIND_BLOCK_WORDS.running
							: REWIND_BLOCK_WORDS["view-only"],
			);
		toast({
			title: "Restored",
			description: `${plural(r.restored.length, "file")} restored, ${r.kept.length} kept`,
		});
	};

	if (target.mode === "undo")
		return (
			<DestructiveConfirm
				open
				onOpenChange={close}
				title="Undo this edit?"
				confirmLabel="Undo edit"
				onConfirm={confirmUndo}
				description={
					<ul data-testid="rewind-confirm" data-mode="undo">
						<li>
							Brings back the {plural(target.turns, "turn")} the edit folded,
							and sets the files back to how they were before it.
						</li>
						<li>The edited message and what followed it fold instead.</li>
						<li>Files you changed since stay.</li>
					</ul>
				}
			>
				<SmallPrint />
			</DestructiveConfirm>
		);

	if (target.mode === "restore") {
		const p = restoreShown.shown;
		const blocked = restorePreview.data ? restorePreview.data.block : p?.block;
		return (
			<DestructiveConfirm
				open
				onOpenChange={close}
				title="Restore from the backup?"
				confirmLabel="Restore"
				onConfirm={confirmRestore}
				isLoading={!p || !!blocked}
				error={
					restorePreview.error
						? getErrorMessage(restorePreview.error)
						: blocked
							? REWIND_BLOCK_WORDS[blocked]
							: null
				}
				description={
					<div data-testid="rewind-confirm" data-mode="restore">
						{restoreShown.changed && (
							<Changed
								what="The files"
								onTake={() => {
									restoreShown.take();
									setTicked(new Set());
								}}
							/>
						)}
						{p ? (
							<RestoreFacts
								threadId={threadId}
								preview={p}
								include={ticked}
								setInclude={setTicked}
							/>
						) : (
							<p>Reading the backup</p>
						)}
					</div>
				}
			>
				<SmallPrint />
			</DestructiveConfirm>
		);
	}

	const p = editShown.shown;
	const block = preview.data ? preview.data.block : p?.block;
	const conversationOnly =
		!!p && p.repos.every((r) => r.state === "unavailable");
	return (
		<DestructiveConfirm
			open
			onOpenChange={close}
			title="Edit and run again?"
			confirmLabel={
				conversationOnly ? "Rewind conversation and send" : "Rewind and send"
			}
			onConfirm={confirmEdit}
			isLoading={!p || !!block}
			error={
				preview.error
					? getErrorMessage(preview.error)
					: block
						? REWIND_BLOCK_WORDS[block]
						: null
			}
			description={
				<div data-testid="rewind-confirm" data-mode="edit">
					{editShown.changed && (
						<Changed
							what="The thread or its files"
							onTake={() => {
								editShown.take();
								setDuring(false);
							}}
						/>
					)}
					{p ? (
						<RewindEditFacts
							preview={p}
							include={during}
							setInclude={setDuring}
						/>
					) : (
						<p>Reading what it would undo</p>
					)}
				</div>
			}
		>
			<SmallPrint />
		</DestructiveConfirm>
	);
}
