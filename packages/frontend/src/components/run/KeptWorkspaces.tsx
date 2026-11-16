// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { KeptWorkspace } from "@prismalens/contracts";
import {
	type QueryKey,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { REASONS } from "@/components/run-workspace/WorkspaceFields";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import { sizeWord } from "@/lib/evidence-files";

/** A finished run's kept workspaces (#925): where each is, why, and Open folder or Remove. */
export function KeptWorkspaces({ runId }: { runId: string }) {
	const options = orpc.runWorkspaces.listForRun.queryOptions({
		input: { runId },
	});
	const query = useQuery(options);
	const kept = query.data?.workspaces ?? [];
	if (!kept.length) return null;
	return (
		<section
			className="pool mt-3 px-3 py-2 text-body"
			data-testid="kept-workspaces"
		>
			<p className="text-meta text-text-2">
				{kept.length === 1
					? "This run's workspace was kept"
					: `${kept.length} of this run's workspaces were kept`}
			</p>
			<KeptWorkspaceRows
				workspaces={kept.map((w) => ({ ...w, runId }))}
				canEdit={query.data?.canEdit ?? false}
				refresh={options.queryKey}
			/>
		</section>
	);
}

/**
 * Kept workspaces with Open folder and Remove; the run page, Settings' over-10 warning and
 * Free space share it. With a size and a title (Free space), each row names its thread.
 */
export function KeptWorkspaceRows({
	workspaces,
	canEdit,
	refresh,
}: {
	workspaces: (KeptWorkspace & {
		runId: string;
		title?: string | null;
		bytes?: number | null;
		live?: boolean;
	})[];
	canEdit: boolean;
	/** Refetched once a Remove settles. */
	refresh: QueryKey;
}) {
	const queryClient = useQueryClient();
	const [confirm, setConfirm] = useState<{ runId: string; dir: string } | null>(
		null,
	);
	const open = useMutation(orpc.runWorkspaces.open.mutationOptions());
	const remove = useMutation({
		...orpc.runWorkspaces.remove.mutationOptions(),
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: refresh });
			void queryClient.invalidateQueries({
				queryKey: orpc.runWorkspaces.removals.key(),
			});
			void queryClient.invalidateQueries({
				queryKey: orpc.runWorkspaces.disk.key(),
			});
		},
	});
	// A refused removal resolves; throwing keeps the dialog open with the reason in it.
	const removeOrExplain = async (target: { runId: string; dir: string }) => {
		const result = await remove.mutateAsync(target);
		if (!result.removed)
			throw new Error(
				`Not removed: ${REASONS[result.reason] ?? result.reason}.`,
			);
	};
	return (
		<>
			{workspaces.map((w) => (
				<div
					key={w.dir}
					className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
				>
					<div className="min-w-0 flex-1 basis-64">
						{w.title !== undefined && (
							<span className="block truncate text-body text-text-1">
								{w.title ?? "A thread no longer listed"}
							</span>
						)}
						<Mono className="block truncate">{w.dir}</Mono>
						<span className="text-meta text-text-3">
							{w.live
								? "Its run is working in it"
								: `${REASONS[w.reason] ?? w.reason}, since ${new Date(w.keptAt).toLocaleString()}`}
						</span>
					</div>
					{w.bytes !== undefined && (
						<span
							className="shrink-0 text-body text-text-2 tabular-nums"
							data-testid="workspace-size"
						>
							{w.bytes === null ? "Size unknown" : sizeWord(w.bytes)}
						</span>
					)}
					{canEdit && !w.live && (
						<div className="flex shrink-0 gap-1">
							<Button
								size="sm"
								variant="secondary"
								disabled={open.isPending}
								onClick={() => open.mutate({ runId: w.runId, dir: w.dir })}
							>
								Open folder
							</Button>
							<Button
								size="sm"
								variant="text"
								onClick={() => setConfirm({ runId: w.runId, dir: w.dir })}
							>
								Remove
							</Button>
						</div>
					)}
				</div>
			))}
			<MutationError error={open.error} />
			<DestructiveConfirm
				open={confirm !== null}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Remove this workspace?"
				description={
					<p>Its uncommitted changes and new files are deleted with it.</p>
				}
				confirmLabel="Remove"
				isPending={remove.isPending}
				onConfirm={() => (confirm ? removeOrExplain(confirm) : undefined)}
			/>
		</>
	);
}
