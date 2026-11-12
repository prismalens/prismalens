// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	DiffScope,
	RevertBlock,
	RevertChangesInput,
	RevertChangesResult,
	WorktreeChanges,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";

/** The thread's diff for one scope (#1101 category 16), polled while a turn runs. */
export function useScopedChanges(
	runId: string,
	scope: DiffScope,
	turn: number | undefined,
	live: boolean,
) {
	return useQuery({
		...orpc.investigations.getChanges.queryOptions({
			input: {
				id: runId,
				scope,
				...(turn !== undefined ? { turn: String(turn) } : {}),
			},
		}),
		refetchInterval: live ? 5000 : false,
		retry: false,
	});
}

/** Files and lines one turn changed, from its snapshots; null until known or with none. */
export function turnCounts(
	data: WorktreeChanges | undefined,
): { files: number; additions: number; deletions: number } | null {
	const ok = data?.repos.filter((r) => r.state === "ok") ?? [];
	if (!ok.length) return null;
	let files = 0;
	let additions = 0;
	let deletions = 0;
	for (const r of ok) {
		if (r.state !== "ok") continue;
		files += r.files.filter((f) => f.status !== "link").length;
		additions += r.additions;
		deletions += r.deletions;
	}
	return { files, additions, deletions };
}

/**
 * One turn's changed files from its start and end snapshots, for the turn's changed-files
 * card (#1104): `turnId` is the seq of the turn's first event.
 */
export function useTurnChanges(runId: string, turnId: number, live = false) {
	const q = useScopedChanges(runId, "turn", turnId, live);
	return { ...q, counts: turnCounts(q.data) };
}

/** The Changes tab's address for one turn: what the card's link opens. */
export function turnChangesSearch(turnId: number) {
	return { panel: "changes" as const, scope: "turn" as const, turn: turnId };
}

export const REVERT_BLOCK_WORDS: Record<RevertBlock, string> = {
	borrowed:
		"This thread works in your own checkout, so PrismaLens only reads it.",
	folder: "This thread works in a plain folder with no history.",
	running: "Stop the agent before reverting; it is still working.",
	"view-only":
		"This device was paired to view and answer. Revert from the host or a device paired to operate.",
};

const REFUSED_WORDS: Record<
	Extract<RevertChangesResult, { state: "refused" }>["reason"],
	string
> = {
	stale: "Changed since you looked. Refresh and try again.",
	conflict: "Changed since the agent's turn, so Undo would lose those edits.",
	blocked: "Revert is not available here.",
	"no-snapshot": "Nothing to revert for this.",
	linked: "A linked file or folder is in the way, so nothing was written.",
	"not-a-hunk": "Revert the whole file for this change.",
	unavailable: "The worktree is not available.",
};

export function refusedWords(
	r: Extract<RevertChangesResult, { state: "refused" }>,
): string {
	if (r.block) return REVERT_BLOCK_WORDS[r.block];
	const base = REFUSED_WORDS[r.reason];
	return r.paths.length ? `${base} ${r.paths.join(", ")}` : base;
}

/** Revert and Undo; refetches every scope after. */
export function useRevert(runId: string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: Omit<RevertChangesInput, "id">) =>
			orpc.investigations.revertChanges.call({ id: runId, ...input }),
		onSettled: () =>
			client.invalidateQueries({
				queryKey: orpc.investigations.getChanges.key(),
			}),
	});
}

/**
 * The snapshot id of the transcript turn that starts at seq `start` and runs until `next`
 * (the following turn's start, or none): the first snapshot taken inside that span.
 */
export function snapshotTurnFor(
	turns: readonly { seq: number }[],
	start: number,
	next: number | null,
): number | null {
	return (
		turns.find((t) => t.seq > start && (next === null || t.seq <= next))?.seq ??
		null
	);
}

/** A turn's files with their added and removed lines, from its snapshots; links and nested repos left out. */
export function turnFilesOf(
	data: WorktreeChanges | undefined,
): { path: string; add: number; del: number }[] {
	return (data?.repos ?? []).flatMap((r) =>
		r.state === "ok"
			? r.files
					.filter((f) => f.status !== "link" && f.status !== "submodule")
					.map((f) => ({
						path: f.path,
						add: f.additions ?? 0,
						del: f.deletions ?? 0,
					}))
			: [],
	);
}

/**
 * One transcript turn's changes from the worktree snapshots, for the turn's changed-files card
 * (#1104): `start` and `next` are the seqs of the messages that open this turn and the next.
 * It counts every file the turn changed, whether or not an edit call named it.
 */
export function useTranscriptTurnChanges(
	runId: string,
	seq: { start: number; next: number | null },
) {
	const all = useScopedChanges(runId, "all", undefined, false);
	const ok = all.data?.repos.find((r) => r.state === "ok" && r.scoped);
	const turns = ok?.state === "ok" ? (ok.scoped?.turns ?? []) : [];
	const turnId = snapshotTurnFor(turns, seq.start, seq.next);
	const turn = useQuery({
		...orpc.investigations.getChanges.queryOptions({
			input: { id: runId, scope: "turn", turn: String(turnId ?? 0) },
		}),
		enabled: turnId !== null,
		retry: false,
	});
	return {
		turnId,
		repo: ok?.repo ?? null,
		counts: turnId === null ? null : turnCounts(turn.data),
		files: turnId === null ? [] : turnFilesOf(turn.data),
	};
}
