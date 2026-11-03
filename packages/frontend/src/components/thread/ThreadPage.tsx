// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import { recordedFindings } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, PanelRight, PanelTop, TriangleAlert } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import { RunDock } from "@/components/investigation/RunDock";
import { Transcript } from "@/components/investigation/Transcript";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import type { EvidenceFiles } from "@/components/run/RunDetailsPanel";
import type { RunStep } from "@/components/run/run-steps";
import { TickDot } from "@/components/schedules/TickDot";
import { Hint } from "@/components/shared/Hint";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { RightPanel } from "@/components/shell/PanelShell";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useResumeInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { useRepository } from "@/lib/api/hooks/use-repositories-orpc";
import { useService } from "@/lib/api/hooks/use-services-orpc";
import { useVisitThread } from "@/lib/api/hooks/use-threads-orpc";
import { uploadThreadAttachment } from "@/lib/attachments";
import { type FileAt, readsOf, stepFile } from "@/lib/evidence-files";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { touchedFiles } from "@/lib/run-panel";
import { cn } from "@/lib/utils";
import { Composer, type ComposerSend, type ComposerState } from "./Composer";
import { StatusBox } from "./StatusBox";
import { type Surface, ThreadPanel } from "./ThreadPanel";

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

/** A header toggle in its fixed slot: there from the first paint, so nothing pops in. */
function HeaderToggle({
	label,
	pressed,
	disabled,
	onToggle,
	icon,
	testId,
	controls,
}: {
	label: string;
	pressed: boolean;
	disabled: boolean;
	onToggle: () => void;
	icon: React.ReactNode;
	testId: string;
	controls: string;
}) {
	return (
		<Hint label={label}>
			<button
				type="button"
				aria-label={label}
				aria-expanded={pressed}
				aria-controls={controls}
				disabled={disabled}
				onClick={onToggle}
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-control transition-colors duration-(--dur-instant) hover:bg-surface-3 disabled:opacity-50",
					pressed ? "bg-surface-3 text-text-1" : "bg-surface-2 text-text-2",
				)}
				data-testid={testId}
			>
				{icon}
			</button>
		</Hint>
	);
}

/**
 * A project, service or no-subject thread's own page (#1020): the transcript spine,
 * the status box and the right panel, both closed until you open them, and the
 * shared composer. Its title is the user's first line, shown as plain text.
 */
export function ThreadPage({ id }: { id: string }) {
	const run = useInvestigationRun(id);
	const { harnesses } = useAgentChoice();
	const resume = useResumeInvestigation();
	const [resumeError, setResumeError] = useState<string | null>(null);
	const [boxOpen, setBoxOpen] = useState(false);
	const [panelOpen, setPanelOpen] = useState(false);
	const [surface, setSurface] = useState<Surface | null>(null);
	const [viewing, setViewing] = useState<FileAt | null>(null);
	const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(new Set());
	const inv = run.investigation;
	useVisitThread(inv?.id ?? null, !run.isActive);
	usePageTitle(inv?.title ?? "Thread");
	const harness = harnesses.find((h) => h.id === inv?.harness);
	const repo = useRepository(inv?.repositoryId ?? "");
	const service = useService(inv?.repositoryId ? "" : (inv?.serviceId ?? ""));
	const workspace = inv?.workspace;

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
	const suspects = useMemo(
		() => recordedFindings(run.events).hypotheses,
		[run.events],
	);

	const openSurface = useCallback((s: Surface) => {
		setSurface(s);
		setPanelOpen(true);
	}, []);
	const openFile = useCallback(
		(f: FileAt) => {
			setViewing(f);
			openSurface("files");
		},
		[openSurface],
	);
	const toggleStep = useCallback(
		(n: number) =>
			setOpenSteps((o) => {
				const next = new Set(o);
				if (!next.delete(n)) next.add(n);
				return next;
			}),
		[],
	);
	const fileOfStep = useCallback(
		(s: RunStep) => stepFile(s, workspace),
		[workspace],
	);
	const steps = useMemo(
		() => ({
			all: run.steps,
			open: openSteps,
			onToggle: toggleStep,
			highlight: null,
			flagged: new Set<number>(),
			asks: run.asks,
			fileOf: fileOfStep,
			onOpenFile: (s: RunStep) => {
				const f = fileOfStep(s);
				if (f) openFile(f);
			},
		}),
		[run.steps, run.asks, openSteps, toggleStep, fileOfStep, openFile],
	);
	const files: EvidenceFiles = useMemo(
		() => ({
			runId: id,
			workspace,
			touched: touchedFiles(run.steps, workspace, []),
			links: [],
			viewing,
			onOpen: (f) => setViewing(f),
			onClose: () => setViewing(null),
			backLabel: "Back to files",
			reads: viewing ? readsOf(viewing, run.steps, workspace) : [],
			codeHost: null,
			stepFile: fileOfStep,
			onOpenHypotheses: () => {},
		}),
		[id, workspace, run.steps, viewing, fileOfStep],
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
	const closePanel = useCallback(() => setPanelOpen(false), []);

	const ready = !run.isLoading && !run.error && !!inv;
	const back = inv ? backOf(inv) : backOf({});
	const [tone, word] = !inv
		? (["muted", ""] as const)
		: run.stopRequested
			? (["live", "Stopping"] as const)
			: STATE[inv.status];
	const header = (
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
				{inv?.title ?? "Thread"}
			</h1>
			{inv && (
				<span
					className="inline-flex items-center gap-2 text-body text-text-2"
					data-testid="thread-state"
				>
					<TickDot tone={tone} />
					{word}
				</span>
			)}
			<HeaderToggle
				label="Status"
				pressed={boxOpen}
				disabled={!ready}
				onToggle={() => setBoxOpen((o) => !o)}
				icon={<PanelTop className="size-4" aria-hidden />}
				testId="status-box-toggle"
				controls="status-box"
			/>
			<HeaderToggle
				label="Panel"
				pressed={panelOpen}
				disabled={!ready}
				onToggle={() => setPanelOpen((o) => !o)}
				icon={<PanelRight className="size-4" aria-hidden />}
				testId="panel-toggle"
				controls="thread-panel"
			/>
		</header>
	);

	if (run.isLoading)
		return (
			<div className="flex h-full min-h-0 flex-col" data-testid="thread-page">
				{header}
				<div className="mx-auto w-full max-w-[760px] px-4 pt-5">
					<Loading rows={5} />
				</div>
			</div>
		);
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
				cwd={workspace?.cwd}
			/>
		) : null;
	const blocked =
		run.ended && !run.resumable && state !== "interrupted"
			? (run.resumeBlockedReason ?? "Can't continue")
			: null;
	const project = repo.data?.fullName ?? service.data?.name ?? null;

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="thread-page">
			{header}
			{boxOpen && (
				<div id="status-box">
					<StatusBox
						runId={inv.id}
						live={run.isActive}
						project={project}
						workspace={workspace}
						onOpenDiff={() => openSurface("diff")}
					/>
				</div>
			)}
			<div className="min-h-0 flex-1">
				{items.length ? (
					<Transcript
						items={items}
						incidentId={null}
						cwd={workspace?.cwd}
						agent={[agentLabel, inv.model].filter(Boolean).join(", ")}
						runName={inv.title ?? "Thread"}
						chat={inv.kind === "chat"}
						steps={steps}
						runId={inv.id}
						foldTurns={{ live: run.isActive }}
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
			<RightPanel open={panelOpen} label="Thread panel" onClose={closePanel}>
				<ThreadPanel
					surface={surface}
					onSurface={setSurface}
					onClose={closePanel}
					runId={inv.id}
					live={run.isActive}
					investigation={inv.kind === "investigation"}
					files={files}
					suspects={suspects}
				/>
			</RightPanel>
		</div>
	);
}
