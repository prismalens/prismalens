// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Undo2 } from "lucide-react";
import { useState } from "react";
import { Hint } from "@/components/shared/Hint";
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
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import {
	REVERT_BLOCK_WORDS,
	refusedWords,
	useRevert,
	useTurnChanges,
} from "./use-scoped-changes";

/**
 * Undo one agent turn's file changes (#1101 category 16): sets every file the turn changed
 * back to its start, only while each still matches the turn's end, then offers Undo again.
 * The transcript's turn card (#1104) mounts it beside Open diff.
 */
export function TurnUndo({
	runId,
	turnId,
	repo,
}: {
	runId: string;
	/** The turn's snapshot id: `snapshotTurnFor` maps a transcript turn to it. */
	turnId: number;
	/** The repo to undo in; the first one the run lists when absent. */
	repo?: string;
}) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const turn = useTurnChanges(runId, turnId);
	const revert = useRevert(runId);
	const ok = turn.data?.repos.find(
		(r) => r.state === "ok" && (!repo || r.repo === repo),
	);
	const scoped = ok?.state === "ok" ? ok.scoped : undefined;
	if (!ok || ok.state !== "ok" || !scoped || scoped.live || !turn.counts?.files)
		return null;
	const block = scoped.revert;
	const n = turn.counts.files;
	const run = async () => {
		const r = await revert.mutateAsync({
			repo: ok.repo,
			scope: "turn",
			turn: turnId,
			from: scoped.from,
			target: { kind: "turn", seq: turnId },
			expect: {},
		});
		if (r.state === "refused") {
			toast({
				title: "Turn not undone",
				description: refusedWords(r),
				variant: "destructive",
			});
			return;
		}
		toast({
			title: `Undid the turn's ${r.paths.length} ${r.paths.length === 1 ? "file" : "files"}`,
			action: (
				<ToastAction
					altText="Redo the turn's changes"
					onClick={() =>
						void revert
							.mutateAsync({
								repo: ok.repo,
								scope: "turn",
								turn: turnId,
								from: scoped.from,
								target: { kind: "undo", revertId: r.revertId },
								expect: {},
							})
							.then((u) =>
								toast(
									u.state === "done"
										? { title: "Turn's changes back" }
										: {
												title: "Not restored",
												description: refusedWords(u),
												variant: "destructive",
											},
								),
							)
					}
				>
					Redo
				</ToastAction>
			),
		});
	};
	return (
		<>
			<Hint
				label={
					block
						? REVERT_BLOCK_WORDS[block]
						: "Set this turn's files back to how they were before it"
				}
			>
				<span>
					<Button
						variant="text"
						size="sm"
						disabled={!!block || revert.isPending}
						onClick={() => setOpen(true)}
						data-testid="turn-undo"
					>
						<Undo2 className="size-3.5" />
						Undo
					</Button>
				</span>
			</Hint>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent data-testid="turn-undo-confirm">
					<AlertDialogHeader>
						<AlertDialogTitle>Undo this turn's changes?</AlertDialogTitle>
						<AlertDialogDescription>
							Sets {n} {n === 1 ? "file" : "files"} back to how they were before
							the turn. Edits you made to other files stay. If one of these
							files changed since, nothing is written. You can redo it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setOpen(false);
								void run();
							}}
							data-testid="turn-undo-confirm-action"
						>
							Undo turn
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
