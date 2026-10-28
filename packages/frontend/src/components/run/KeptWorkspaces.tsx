// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { REASONS } from "@/components/run-workspace/WorkspaceFields";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";

/** A finished run's kept workspaces (#925): where each is, why, and Open folder or Remove. */
export function KeptWorkspaces({ runId }: { runId: string }) {
	const queryClient = useQueryClient();
	const options = orpc.runWorkspaces.listForRun.queryOptions({
		input: { runId },
	});
	const query = useQuery(options);
	const [confirm, setConfirm] = useState<string | null>(null);
	const open = useMutation(orpc.runWorkspaces.open.mutationOptions());
	const remove = useMutation({
		...orpc.runWorkspaces.remove.mutationOptions(),
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: options.queryKey });
		},
	});
	const kept = query.data?.workspaces ?? [];
	if (!kept.length) return null;
	const canEdit = query.data?.canEdit ?? false;
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
			{kept.map((w) => (
				<div
					key={w.dir}
					className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
				>
					<div className="min-w-0 flex-1 basis-64">
						<Mono className="block truncate">{w.dir}</Mono>
						<span className="text-meta text-text-3">
							{REASONS[w.reason] ?? w.reason}, since{" "}
							{new Date(w.keptAt).toLocaleString()}
						</span>
					</div>
					{canEdit && (
						<div className="flex shrink-0 gap-1">
							<Button
								size="sm"
								variant="secondary"
								disabled={open.isPending}
								onClick={() => open.mutate({ runId, dir: w.dir })}
							>
								Open folder
							</Button>
							<Button
								size="sm"
								variant="text"
								onClick={() => setConfirm(w.dir)}
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
				onConfirm={() =>
					confirm ? remove.mutateAsync({ runId, dir: confirm }) : undefined
				}
			/>
		</section>
	);
}
