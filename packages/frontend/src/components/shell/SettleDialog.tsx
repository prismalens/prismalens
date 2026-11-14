// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SETTLE_UNDO_MS, type SettlePreview } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useSettleThread } from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import {
	endsNothing,
	holdCount,
	holdWords,
	SETTLE_HOLDS,
	type SettleHold,
	settleEndsLine,
} from "@/lib/settle-holds";
import { settleConfirm } from "@/lib/settle-summary";

/** One line per hold the thread has, with its icon; a kept worktree says why. */
export function SettleHolds({ preview }: { preview: SettlePreview }) {
	const holds = (Object.keys(SETTLE_HOLDS) as SettleHold[]).filter(
		(h) => holdCount(preview, h) > 0,
	);
	const kept = preview.worktrees.filter((w) => w.action === "keep");
	if (!holds.length && !kept.length)
		return (
			<p className="text-meta text-text-3" data-testid="settle-holds-none">
				{settleEndsLine(preview)}
			</p>
		);
	return (
		<ul className="flex flex-col gap-1.5" data-testid="settle-holds">
			{holds.map((h) => {
				const { Icon } = SETTLE_HOLDS[h];
				return (
					<li
						key={h}
						className="flex items-center gap-2 text-body text-text-1"
						data-hold={h}
					>
						<span className="flex shrink-0 text-text-3">
							<Icon className="size-3.5" aria-hidden />
						</span>
						Ends {holdWords(h, holdCount(preview, h))}
					</li>
				);
			})}
			{kept.map((w) => (
				<li
					key={w.dir}
					className="flex items-center gap-2 text-body text-text-2"
					data-hold="worktree-kept"
				>
					<span className="flex shrink-0 text-text-3">
						<SETTLE_HOLDS.worktrees.Icon className="size-3.5" aria-hidden />
					</span>
					<span className="min-w-0 truncate">
						Keeps {w.dir.split(/[\\/]/).pop()}
						{w.reason ? `: ${w.reason}` : ""}
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * Settle from a thread's menu (#1101 category 20): what it ends first, then Settle. With
 * nothing to end it settles at once, as a row does; the toast's Undo restores it whole.
 */
export function SettleDialog({
	thread,
	onClose,
	onSettled,
}: {
	thread: { id: string; title: string | null };
	onClose: () => void;
	/** The settle landed; null once Undo put it back. */
	onSettled?: (at: string | null) => void;
}) {
	const preview = useQuery({
		...orpc.threads.settlePreview.queryOptions({ input: { id: thread.id } }),
		// The open dialog holds what it showed; it is read once per Settle.
		refetchOnWindowFocus: false,
	});
	const settle = useSettleThread();
	const running = preview.data?.running ?? 0;
	const confirm = () =>
		settle.mutate(
			{
				id: thread.id,
				settled: true,
				...(running ? { stopRunning: true } : {}),
			},
			{
				onSuccess: ({ previous, undoUntil, ended }) => {
					onSettled?.(new Date().toISOString());
					onClose();
					const left = undoUntil
						? Math.max(0, Date.parse(undoUntil) - Date.now())
						: SETTLE_UNDO_MS;
					toast({
						title: "Settled",
						description:
							ended &&
							(Object.keys(SETTLE_HOLDS) as SettleHold[]).some(
								(h) => holdCount(ended, h) > 0,
							)
								? settleEndsLine(ended)
								: undefined,
						duration: left,
						action: (
							<ToastAction
								altText="Undo the settle"
								onClick={() =>
									settle.mutate(
										{ id: thread.id, settled: false, restore: previous },
										{
											onSuccess: () => onSettled?.(null),
											onError: (e) =>
												toast({
													title: "Not undone",
													description: getErrorMessage(e),
													variant: "destructive",
												}),
										},
									)
								}
								data-testid="settle-undo"
							>
								Undo
							</ToastAction>
						),
					});
				},
			},
		);
	// Only a fresh preview may skip the confirm: a cached one can miss a watch armed since.
	const quiet =
		!!preview.data && !preview.isFetching && endsNothing(preview.data);
	const fired = useRef(false);
	useEffect(() => {
		if (!quiet || fired.current) return;
		fired.current = true;
		confirm();
	});
	if (
		!settle.isError &&
		!preview.isError &&
		(quiet || !preview.data || preview.isFetching)
	)
		return null;
	return (
		<AlertDialog open onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent data-testid="settle-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>
						{settleConfirm({ running }) ?? "Settle this thread?"}
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="flex flex-col gap-2">
							{preview.data ? (
								<SettleHolds preview={preview.data} />
							) : preview.isError ? (
								<p className="text-meta text-danger">
									{getErrorMessage(preview.error)}
								</p>
							) : (
								<div className="shimmer h-4 w-2/3 rounded-[4px]" aria-busy />
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{settle.isError && (
					<p className="text-meta text-danger" role="alert">
						{getErrorMessage(settle.error)}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={settle.isPending || !preview.data}
						onClick={(e) => {
							e.preventDefault();
							confirm();
						}}
						data-testid="settle-confirm"
					>
						{running ? "Stop and settle" : "Settle"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
