// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspace } from "@prismalens/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderGit2, FolderOpen, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/lib/api/orpc-client";
import { changeTotals, useWorktreeChanges } from "./WorktreeDiff";

/**
 * The thread's status box (#1020), closed until you open it: the project and its
 * workspace, Open folder, the branch, and the changes so far, which open the Diff.
 * An incident's run adds its own controls through `extra`.
 */
export function StatusBox({
	runId,
	live,
	project,
	workspace,
	onOpenDiff,
	extra,
}: {
	runId: string;
	live: boolean;
	/** The project's or service's name, when the thread has one. */
	project: string | null;
	workspace: RunWorkspace | null | undefined;
	onOpenDiff: () => void;
	extra?: ReactNode;
}) {
	const repo = workspace?.repos[0];
	const changes = useWorktreeChanges(runId, live);
	const totals = changeTotals(changes.data);
	const kept = useQuery(
		orpc.runWorkspaces.listForRun.queryOptions({ input: { runId } }),
	);
	const open = useMutation(orpc.runWorkspaces.open.mutationOptions());
	return (
		<section
			aria-label="Status"
			className="mx-auto flex w-full max-w-[760px] flex-col gap-1.5 px-4 pt-2 text-body motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-300"
			data-testid="status-box"
		>
			<div className="flex flex-col gap-1.5 rounded-surface bg-surface-1 px-3 py-2.5">
				<Row icon={<FolderGit2 className="size-3.5" aria-hidden />}>
					<span
						className="min-w-0 truncate text-text-1"
						data-testid="status-project"
					>
						{project ?? "No project"}
					</span>
					{repo && (
						<Mono
							className="min-w-0 truncate text-text-3"
							data-testid="status-workspace"
						>
							{workspace?.cwd ?? repo.dir}
						</Mono>
					)}
					{repo && kept.data?.canEdit && (
						<Button
							size="sm"
							variant="secondary"
							className="ml-auto shrink-0"
							disabled={open.isPending}
							onClick={() => open.mutate({ runId, dir: repo.dir })}
							data-testid="status-open-folder"
						>
							<FolderOpen className="size-3.5" aria-hidden />
							Open folder
						</Button>
					)}
				</Row>
				{workspace?.layout === "folder" && (
					<Row icon={<span className="size-3.5" aria-hidden />}>
						<Mono
							className="min-w-0 truncate text-text-3"
							data-testid="status-folder"
						>
							{workspace.cwd}
						</Mono>
					</Row>
				)}
				{repo?.branch && (
					<Row icon={<GitBranch className="size-3.5" aria-hidden />}>
						<Mono
							className="min-w-0 truncate text-text-1"
							data-testid="status-branch"
						>
							{repo.branch}
						</Mono>
						<span className="shrink-0 text-meta text-text-3">
							from {repo.head.slice(0, 7)}
						</span>
					</Row>
				)}
				{repo && (
					<Row icon={<span className="size-3.5" aria-hidden />}>
						<span className="text-text-2">Changes</span>
						{changes.isLoading ? (
							<Skeleton
								className="h-3 w-14"
								data-testid="status-changes-loading"
							/>
						) : totals ? (
							<button
								type="button"
								onClick={onOpenDiff}
								className="text-meta tabular-nums underline-offset-[3px] hover:underline"
								data-testid="status-changes"
							>
								<span className="text-ok">+{totals.additions}</span>{" "}
								<span className="text-danger">−{totals.deletions}</span>
							</button>
						) : (
							<span
								className="text-meta text-text-3"
								data-testid="status-changes-none"
							>
								{changes.error ? "Changes unknown" : "Workspace gone"}
							</span>
						)}
					</Row>
				)}
				{extra}
				<MutationError error={open.error} />
			</div>
		</section>
	);
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="flex shrink-0 text-text-3">{icon}</span>
			{children}
		</div>
	);
}
