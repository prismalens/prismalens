// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RewindBlock,
	RewindPreview,
	RewindResult,
	RewindUndoResult,
} from "@prismalens/contracts";
import { REWIND_BLOCK_WORDS } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";

/** What the rewind dialog is showing: an edit to confirm, an undo, or an interrupted operation's restore. */
export type RewindTarget =
	| { mode: "edit"; seq: number; text: string }
	| { mode: "undo"; rewindId: string; turns: number }
	| { mode: "restore"; op: string };

/** What editing message `seq` would undo, read fresh each time the dialog opens. */
export function useRewindPreview(id: string, seq: number | null) {
	return useQuery({
		...orpc.threads.rewindPreview.queryOptions({
			input: { id, seq: seq ?? 0 },
		}),
		enabled: seq !== null,
		staleTime: 0,
		gcTime: 0,
	});
}

export function useRestorePreview(id: string, op: string | null) {
	return useQuery({
		...orpc.threads.rewindRestorePreview.queryOptions({
			input: { id, op: op ?? "" },
		}),
		enabled: op !== null,
		staleTime: 0,
		gcTime: 0,
	});
}

/** The rewind, undo and restore calls; each reloads the thread's row after. */
export function useRewindCalls(id: string) {
	const client = useQueryClient();
	const settled = () =>
		void client.invalidateQueries({ queryKey: investigationKeys.detail(id) });
	return {
		rewind: useMutation({
			...orpc.threads.rewind.mutationOptions(),
			onSettled: settled,
		}),
		undo: useMutation({
			...orpc.threads.rewindUndo.mutationOptions(),
			onSettled: settled,
		}),
		restore: useMutation({
			...orpc.threads.rewindRestore.mutationOptions(),
			onSettled: settled,
		}),
	};
}

/** The page's open dialog, and the text a refused admission handed back to its editor. */
export function useRewind() {
	const [target, setTarget] = useState<RewindTarget | null>(null);
	const [kept, setKept] = useState<{
		seq: number;
		text: string;
		why: string;
	} | null>(null);
	return {
		target,
		open: setTarget,
		close: () => setTarget(null),
		kept,
		setKept,
	};
}

/** The words for a refusal: a block's own, or what changed. */
export function rewindRefusalWords(
	r:
		| Extract<RewindResult, { state: "refused" }>
		| Extract<RewindUndoResult, { state: "refused" }>,
): string {
	if (r.reason in REWIND_BLOCK_WORDS)
		return REWIND_BLOCK_WORDS[r.reason as RewindBlock];
	switch (r.reason) {
		case "stale":
			return "The thread or its files changed since this was shown. Open it again to see what it would do now.";
		case "conflict":
			return `A file's folder became a link, or its snapshot is gone${r.paths.length ? `: ${r.paths.map((p) => p.path).join(", ")}` : ""}. Nothing was changed.`;
		case "superseded":
			return "Only the latest edit can be undone.";
		case "already-undone":
			return "This edit was already undone.";
		default:
			return "It did not run.";
	}
}

/** The one-line count the toast and the fold row share. */
export function rewoundWords(reverted: number, kept: number): string {
	return `Rewound: ${reverted} ${reverted === 1 ? "file" : "files"} set back, ${kept} kept`;
}

export type { RewindPreview };
