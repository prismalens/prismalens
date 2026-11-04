// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import { RunDock } from "@/components/investigation/RunDock";
import { Transcript } from "@/components/investigation/Transcript";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { TickDot } from "@/components/schedules/TickDot";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useResumeInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { uploadThreadAttachment } from "@/lib/attachments";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { Composer, type ComposerSend, type ComposerState } from "./Composer";

/** Each run state's tone and its word: two words at most. */
const STATE = {
	pending: ["live", "Starting"],
	running: ["live", "Working"],
	completed: ["ok", "Done"],
	failed: ["bad", "Failed"],
	cancelled: ["muted", "Stopped"],
} as const;

/** Where Back goes: the thread's project, its service, or home. */
function backOf(inv: {
	repositoryId?: string | null;
	serviceId?: string | null;
}) {
	if (inv.repositoryId)
		return {
			to: "/projects/$id" as const,
			params: { id: inv.repositoryId },
			label: "Back to the project",
		};
	if (inv.serviceId)
		return {
			to: "/services/$id" as const,
			params: { id: inv.serviceId },
			label: "Back to the service",
		};
	return { to: "/" as const, params: {}, label: "Back home" };
}

/**
 * A project, service or no-subject thread's own page (#1020): the transcript and the
 * shared composer. Its title is the user's first line, shown as plain text.
 */
export function ThreadPage({ id }: { id: string }) {
	const run = useInvestigationRun(id);
	const { harnesses } = useAgentChoice();
	const resume = useResumeInvestigation();
	const [resumeError, setResumeError] = useState<string | null>(null);
	const inv = run.investigation;
	usePageTitle(inv?.title ?? "Thread");
	const harness = harnesses.find((h) => h.id === inv?.harness);

	const items = useMemo(
		() =>
			deriveTranscript(run.events, {
				pending: run.pending,
				modelName: (m) => modelName(harness, m) ?? m,
				agentName: (h) => harnesses.find((x) => x.id === h)?.label ?? h,
				run: inv
					? {
							id: inv.id,
							status: inv.status,
							live: run.isActive,
							stopRequested: run.stopRequested,
							error: inv.error,
							startedAt: inv.startedAt,
							completedAt: inv.completedAt,
							kind: inv.kind,
							hasReport: false,
							continuable: false,
							lastTurnOutcome: inv.lastTurnOutcome,
							accessLevel: inv.accessLevel,
							endReason: inv.endReason,
						}
					: undefined,
			}),
		[
			run.events,
			run.pending,
			run.isActive,
			run.stopRequested,
			inv,
			harness,
			harnesses,
		],
	);

	const { sendMessage } = run;
	const onSend = useCallback(
		async ({ text, files }: ComposerSend, now: boolean) => {
			const attachments = await Promise.all(
				files.map((f) => uploadThreadAttachment({ runId: id }, f)),
			);
			await sendMessage(text, now ? "now" : "queue", {
				attachments,
				kind: "chat",
			});
		},
		[id, sendMessage],
	);

	if (run.isLoading) return <Loading />;
	if (run.error || !inv) {
		const home = (
			<Button variant="text" size="sm" asChild>
				<Link to="/">Back home</Link>
			</Button>
		);
		const gone =
			!run.error || (run.error as { status?: number }).status === 404;
		return gone ? (
			<NotFound text="No thread here." back={home} />
		) : (
			<Problem
				text={getErrorMessage(run.error)}
				onRetry={() => void run.refetch()}
				back={home}
			/>
		);
	}

	const back = backOf(inv);
	const [tone, word] = run.stopRequested
		? (["live", "Stopping"] as const)
		: STATE[inv.status];
	const state: ComposerState = run.isActive
		? "live"
		: inv.endReason === "interrupted"
			? "interrupted"
			: "ready";
	const asks = run.isActive
		? run.asks.filter((a) => a.state === "waiting")
		: [];
	const agentLabel = harness?.label ?? "The agent";
	const dock =
		asks.length > 0 || run.queued.length > 0 ? (
			<RunDock
				asks={asks}
				queued={run.queued}
				runId={inv.id}
				agent={agentLabel}
				cwd={inv.workspace?.cwd}
			/>
		) : null;
	const branch = inv.workspace?.repos[0]?.branch ?? null;
	const blocked =
		run.ended && !run.resumable && state !== "interrupted"
			? (run.resumeBlockedReason ?? "Can't continue")
			: null;

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="thread-page">
			<header className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2">
				<Button variant="ghost" size="icon-lg" aria-label={back.label} asChild>
					<Link to={back.to} params={back.params}>
						<ChevronLeft />
					</Link>
				</Button>
				<h1
					className="min-w-0 flex-1 truncate text-title"
					data-testid="thread-title"
				>
					{inv.title ?? "Thread"}
				</h1>
				<span
					className="inline-flex items-center gap-2 text-body text-text-2"
					data-testid="thread-state"
				>
					<TickDot tone={tone} />
					{word}
				</span>
			</header>
			<div className="min-h-0 flex-1">
				{items.length ? (
					<Transcript
						items={items}
						incidentId={null}
						cwd={inv.workspace?.cwd}
						agent={[agentLabel, inv.model].filter(Boolean).join(", ")}
						runName={inv.title ?? "Thread"}
					/>
				) : (
					<p className="px-5 pt-6 text-body text-text-3">
						{run.isActive ? "Starting the agent" : "Nothing yet"}
					</p>
				)}
			</div>
			{inv.status === "failed" && inv.error && (
				<div
					role="status"
					className="mx-auto flex w-full max-w-[760px] items-start gap-2.5 px-4 text-body"
				>
					<TriangleAlert
						className="mt-0.5 size-4 shrink-0 text-danger"
						aria-hidden
					/>
					<span>{inv.error}</span>
				</div>
			)}
			<div className="shrink-0 px-4 pt-2 pb-3">
				<div className="mx-auto w-full max-w-[760px]">
					<Composer
						state={state}
						onSend={onSend}
						onStop={() => run.stop()}
						stopping={run.stopRequested}
						onResume={() => {
							setResumeError(null);
							resume.mutate(
								{ id: inv.id },
								{ onError: (e) => setResumeError(getErrorMessage(e)) },
							);
						}}
						resuming={resume.isPending}
						placeholder={run.isActive ? "Message the agent" : "Reply"}
						choice={{
							harness,
							model: inv.model ?? "",
							effort: inv.effort ?? null,
							accessLevel: (inv.accessLevel ?? "supervised") as AccessLevel,
						}}
						onChoice={() => {}}
						locked
						branch={branch}
						dock={dock}
						blockedReason={blocked}
					/>
					{resumeError && (
						<p className="px-3 pt-1 text-meta text-danger" role="alert">
							{resumeError}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
