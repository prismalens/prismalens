// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspace } from "@prismalens/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderGit2, FolderOpen, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSecondClock } from "@/hooks/use-clock";
import { orpc } from "@/lib/api/orpc-client";
import { formatElapsed } from "@/lib/format-time";
import { seconds } from "@/lib/investigation-events";
import { SUBAGENT_WORD, type SubagentView } from "@/lib/subagents";
import { SubagentMark } from "./SubagentNode";
import { changeTotals, useWorktreeTotals } from "./worktree-totals";

/**
 * The thread's status box (#1020), closed until you open it: the project and its
 * workspace, Open folder, the branch, the changes so far, which open the Diff, and
 * the sub-agents. An incident's run adds its own controls through `extra`.
 */
export function StatusBox({
	runId,
	live,
	project,
	workspace,
	onOpenDiff,
	extra,
	subagents = [],
	onOpenSubagent,
}: {
	runId: string;
	live: boolean;
	/** The project's or service's name, when the thread has one. */
	project: string | null;
	workspace: RunWorkspace | null | undefined;
	onOpenDiff: () => void;
	extra?: ReactNode;
	/** Running ones listed, finished ones folded under Earlier (#1025). */
	subagents?: readonly SubagentView[];
	onOpenSubagent?: (sessionId: string) => void;
}) {
	const repo = workspace?.repos[0];
	const changes = useWorktreeTotals(runId, live);
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
				{subagents.length > 0 && (
					<SubagentList agents={subagents} onOpen={onOpenSubagent} />
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

/** Running sub-agents with their timers, finished ones folded under Earlier; each row opens its view. */
export function SubagentList({
	agents,
	onOpen,
}: {
	agents: readonly SubagentView[];
	onOpen?: (sessionId: string) => void;
}) {
	const running = agents.filter((a) => a.state === "running");
	const earlier = agents.filter((a) => a.state !== "running");
	return (
		<div className="flex flex-col gap-0.5" data-testid="status-subagents">
			<span className="text-meta text-text-3">Sub-agents</span>
			{running.map((a) => (
				<SubagentRow key={a.sessionId} agent={a} onOpen={onOpen} />
			))}
			{earlier.length > 0 && (
				<details className="group" data-testid="status-subagents-earlier">
					<summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 text-meta text-text-2 hover:text-text-1">
						<ChevronRight
							aria-hidden
							className="size-3 shrink-0 text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90 motion-reduce:transition-none"
						/>
						Earlier
						<span className="text-text-3 tabular-nums">{earlier.length}</span>
					</summary>
					{earlier.map((a) => (
						<SubagentRow key={a.sessionId} agent={a} onOpen={onOpen} />
					))}
				</details>
			)}
		</div>
	);
}

function SubagentRow({
	agent,
	onOpen,
}: {
	agent: SubagentView;
	onOpen?: (sessionId: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onOpen?.(agent.sessionId)}
			className="flex min-h-6 w-full min-w-0 items-center gap-2 rounded-control px-1 text-left transition-colors duration-(--dur-instant) hover:bg-surface-2"
			data-testid="status-subagent"
			data-state={agent.state}
		>
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				<SubagentMark state={agent.state} />
			</span>
			<span className="min-w-0 flex-1 truncate text-text-1">{agent.title}</span>
			{agent.state === "running" ? (
				<Elapsed since={agent.startedAt} />
			) : (
				<span className="shrink-0 text-meta text-text-3">
					{SUBAGENT_WORD[agent.state]}
				</span>
			)}
		</button>
	);
}

/** Counts up on the shared clock in its own leaf, so the box does not redraw each second. */
function Elapsed({ since }: { since: string }) {
	const now = useSecondClock();
	return (
		<span
			className="shrink-0 text-meta text-text-3 tabular-nums"
			data-testid="status-subagent-elapsed"
		>
			{formatElapsed(now === null ? 0 : seconds(since, now))}
		</span>
	);
}
