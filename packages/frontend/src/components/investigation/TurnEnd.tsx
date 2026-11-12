// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileDiff, Flag, Scale } from "lucide-react";
import { useState } from "react";
import { Status } from "@/components/kit";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import type { RunStep } from "@/components/run/run-steps";
import { Hint } from "@/components/shared/Hint";
import { TurnUndo } from "@/components/thread/diff/TurnUndo";
import {
	snapshotTurnFor,
	useScopedChanges,
	useTurnChanges,
} from "@/components/thread/diff/use-scoped-changes";
import { compose } from "@/lib/compose";
import { shortPath } from "@/lib/report-view";
import {
	type ChangedFile,
	fileFlags,
	noiseLine,
	RISK_WORD,
	reviewTurn,
	SPLIT_ASK,
	type TurnReview,
	testLine,
	testVerdict,
} from "@/lib/turn-review";
import type { TurnSummary } from "@/lib/turn-summary";
import { cn } from "@/lib/utils";

const FILES_SHOWN = 6;

/** The seqs of the messages that start this turn and the next (null: none yet). */
export interface TurnSeq {
	start: number;
	next: number | null;
}

/** The turn's snapshot id, once the run's snapshot list names one in its span. */
function useTurnSnapshot(runId: string | undefined, seq: TurnSeq | undefined) {
	const all = useScopedChanges(runId ?? "", "all", undefined, false);
	if (!runId || !seq) return null;
	const ok = all.data?.repos.find((r) => r.state === "ok" && r.scoped);
	const turns = ok?.state === "ok" ? ok.scoped?.turns : undefined;
	const turnId = turns ? snapshotTurnFor(turns, seq.start, seq.next) : null;
	return ok && turnId !== null ? { turnId, repo: ok.repo } : null;
}

/** The turn's files with their status, from its snapshots when they exist. */
function SnapshotFiles({
	runId,
	turnId,
	children,
}: {
	runId: string;
	turnId: number;
	children: (files: ChangedFile[] | null) => React.ReactNode;
}) {
	const turn = useTurnChanges(runId, turnId);
	const files = (turn.data?.repos ?? []).flatMap((r) =>
		r.state === "ok"
			? r.files
					.filter((f) => f.status !== "link" && f.status !== "submodule")
					.map((f) => ({
						path: f.path,
						add: f.additions ?? 0,
						del: f.deletions ?? 0,
						status: f.status,
					}))
			: [],
	);
	return children(turn.data ? files : null);
}

/**
 * What ends a finished turn (#1101 cat 9, #1110): one summary line, then the verdict a
 * reviewer judges from without opening the diff: files and lines with bulk left out,
 * the tests the turn ran, risk flags, and a size gate; Open diff and Undo beside it.
 */
export function TurnEnd({
	summary,
	steps,
	cwd,
	onOpenDiff,
	runId,
	turnSeq,
}: {
	summary: TurnSummary;
	/** The turn's tool steps, for the tests it ran. */
	steps?: readonly RunStep[];
	cwd?: string | null;
	onOpenDiff?: () => void;
	/** With the turn's seqs, the card reads the turn's snapshot and offers Undo (#1110). */
	runId?: string;
	turnSeq?: TurnSeq;
}) {
	const snap = useTurnSnapshot(runId, turnSeq);
	const edited: ChangedFile[] = summary.files;
	const body = (files: ChangedFile[]) => (
		<TurnVerdict
			summary={summary}
			files={files}
			steps={steps}
			cwd={cwd}
			onOpenDiff={onOpenDiff}
			undo={
				runId && snap ? (
					<TurnUndo runId={runId} turnId={snap.turnId} repo={snap.repo} />
				) : null
			}
		/>
	);
	return (
		<li className="flex min-w-0 flex-col" data-testid="turn-end">
			{summary.text && (
				<p className="text-meta text-text-3" data-testid="turn-summary">
					{summary.text}
				</p>
			)}
			{runId && snap ? (
				<SnapshotFiles runId={runId} turnId={snap.turnId}>
					{(files) => body(files?.length ? files : edited)}
				</SnapshotFiles>
			) : (
				body(edited)
			)}
		</li>
	);
}

/** The verdict lines for a set of changed files; the gallery renders it from fixtures. */
export function TurnVerdict({
	summary,
	files,
	steps,
	cwd,
	onOpenDiff,
	undo,
}: {
	summary: Pick<TurnSummary, "text">;
	files: readonly ChangedFile[];
	steps?: readonly RunStep[];
	cwd?: string | null;
	onOpenDiff?: () => void;
	undo?: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	if (files.length === 0) return null;
	const review = reviewTurn(files);
	const tests = steps ? testVerdict(steps) : null;
	const noise = noiseLine(review.noise);
	const shown = review.reviewed.files;
	return (
		<div className="group/turn min-w-0" data-testid="turn-changes">
			<div className="flex min-w-0 items-center gap-2">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					className={cn(TOOL_LINE, "flex-1")}
					data-testid="turn-changes-toggle"
				>
					<FileDiff
						aria-hidden
						className="size-3.5 shrink-0 stroke-[1.75] text-text-3"
					/>
					<span className="shrink-0">
						Changed {shown.length} {shown.length === 1 ? "file" : "files"}
					</span>
					<span className="shrink-0 font-mono text-mono tabular-nums">
						<span className="text-ok">+{review.reviewed.add}</span>{" "}
						<span className="text-danger">−{review.reviewed.del}</span>
					</span>
					{noise && (
						<span
							className="min-w-0 truncate text-text-3"
							data-testid="turn-noise"
						>
							· {noise}
						</span>
					)}
					<span className="flex-1" />
					<ToolLineChevron open={open} />
				</button>
				{onOpenDiff && (
					<button
						type="button"
						onClick={onOpenDiff}
						className="shrink-0 rounded-control px-1.5 text-meta text-text-2 outline-none hover:text-text-1 focus-visible:ring-1 focus-visible:ring-accent"
						data-testid="turn-changes-open"
					>
						Open diff
					</button>
				)}
				{undo}
			</div>
			<VerdictLine review={review} tests={tests} edited={shown.length > 0} />
			{open && (
				<ul className="m-0 flex list-none flex-col p-0 pb-1 pl-[22px]">
					{[...shown, ...review.noise].slice(0, FILES_SHOWN).map((f) => {
						const flags = fileFlags(f).filter((x) => x !== "lockfile");
						return (
							<li
								key={f.path}
								className="flex h-6 min-w-0 items-center gap-2 font-mono text-mono"
								data-testid="turn-changes-file"
							>
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										f.status === "deleted"
											? "text-text-3 line-through"
											: "text-text-2",
									)}
								>
									{shortPath(f.path, cwd)}
								</span>
								{flags.length > 0 && (
									<Hint label={flags.map((x) => RISK_WORD[x]).join(", ")}>
										<Flag
											aria-label={flags.map((x) => RISK_WORD[x]).join(", ")}
											className="size-3 shrink-0 text-warn"
										/>
									</Hint>
								)}
								<span className="shrink-0 text-ok tabular-nums">+{f.add}</span>
								<span className="shrink-0 text-danger tabular-nums">
									−{f.del}
								</span>
							</li>
						);
					})}
					{files.length > FILES_SHOWN && (
						<li className="text-meta text-text-3">
							{files.length - FILES_SHOWN} more in the diff
						</li>
					)}
				</ul>
			)}
		</div>
	);
}

/** Tests, blockers, risk flags and the size gate, each said once, on one quiet line. */
function VerdictLine({
	review,
	tests,
	edited,
}: {
	review: TurnReview;
	tests: ReturnType<typeof testVerdict>;
	edited: boolean;
}) {
	const flags = review.flags.filter((f) => f.flag !== "lockfile");
	const parts: React.ReactNode[] = [];
	if (review.blockers.length)
		parts.push(
			<Hint key="block" label={review.blockers.join(", ")}>
				<span data-testid="turn-blocker">
					<Status
						kind="blocked"
						word={
							review.blockers.length === 1
								? "Removes a check"
								: `Removes ${review.blockers.length} checks`
						}
					/>
				</span>
			</Hint>,
		);
	if (tests)
		parts.push(
			<span key="tests" data-testid="turn-tests">
				<Status
					kind={tests.ok === null ? "working" : tests.ok ? "done" : "failed"}
					word={testLine(tests)}
				/>
			</span>,
		);
	else if (edited)
		parts.push(
			<span key="tests" className="text-text-3" data-testid="turn-tests">
				No tests run
			</span>,
		);
	if (flags.length)
		parts.push(
			<Hint
				key="flags"
				label={flags
					.map((f) => `${RISK_WORD[f.flag]}: ${f.paths.join(", ")}`)
					.join("; ")}
			>
				<span
					className="inline-flex min-w-0 items-center gap-1.5 text-text-2"
					data-testid="turn-flags"
				>
					<Flag aria-hidden className="size-3.5 shrink-0 text-warn" />
					<span className="truncate">
						{flags.map((f) => RISK_WORD[f.flag]).join(", ")}
					</span>
				</span>
			</Hint>,
		);
	if (!parts.length && !review.tooBig) return null;
	return (
		<div className="flex min-w-0 flex-col gap-1 pb-1 pl-[22px] text-meta">
			{parts.length > 0 && (
				<div
					className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
					data-testid="turn-verdict"
				>
					{parts}
				</div>
			)}
			{review.tooBig && (
				<div
					className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
					data-testid="turn-too-big"
				>
					<span className="inline-flex items-center gap-1.5">
						<Scale aria-hidden className="size-3.5 shrink-0 text-warn" />
						<span className="font-medium text-text-1">Too big to judge</span>
						<span className="text-text-2 tabular-nums">
							{(review.reviewed.add + review.reviewed.del).toLocaleString()}{" "}
							lines in {review.areas} {review.areas === 1 ? "area" : "areas"}
						</span>
					</span>
					<button
						type="button"
						onClick={() => compose(SPLIT_ASK)}
						className="rounded-control font-medium text-text-1 outline-none hover:text-accent focus-visible:ring-1 focus-visible:ring-accent"
						data-testid="turn-ask-split"
					>
						Ask to split
					</button>
				</div>
			)}
		</div>
	);
}
