// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import { pendingAsks, recordedFindings } from "@prismalens/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, PanelRight, PanelTop, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import { RunDock } from "@/components/investigation/RunDock";
import { Transcript } from "@/components/investigation/Transcript";
import { hasTranscriptNode } from "@/components/investigation/transcript/registry";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import type { TranscriptWindow } from "@/components/investigation/WindowedTranscript";
import { BrowserTab } from "@/components/run/BrowserTab";
import {
	type EvidenceFiles,
	FilesPane,
	StepsList,
} from "@/components/run/RunDetailsPanel";
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
import { useThreadContext } from "@/lib/api/hooks/use-thread-context-orpc";
import { useVisitThread } from "@/lib/api/hooks/use-threads-orpc";
import { uploadThreadAttachment } from "@/lib/attachments";
import {
	interceptSend,
	messageFields,
	type SendEnvelope,
	uploadEach,
} from "@/lib/composer-send";
import { desktopBridge } from "@/lib/desktop";
import { type FileAt, readsOf, stepFile } from "@/lib/evidence-files";
import { failureStatusLine } from "@/lib/failure-sentence";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { openAsksOf } from "@/lib/run-asks";
import { fileFromParam, fileParam, touchedFiles } from "@/lib/run-panel";
import { deriveSubagents } from "@/lib/subagents";
import { cn } from "@/lib/utils";
import { Composer, type ComposerState } from "./Composer";
import { FindBar } from "./find/FindBar";
import { paintHighlights, useThreadFind } from "./find/use-thread-find";
import { KindTab } from "./panel/KindTab";
import { hasDesktopBrowser, hrefOf, placeOf } from "./panel/panel-links";
import {
	type PanelId,
	type PanelSearch,
	panelTabs,
	rememberedTab,
	rememberTab,
	shownTab,
} from "./panel/panel-model";
import { PanelStack, ThreadSidePanel } from "./panel/ThreadSidePanel";
import { ThreadTab } from "./panel/ThreadTab";
import { TranscriptRail } from "./rail/TranscriptRail";
import { StatusBox } from "./StatusBox";
import { SubagentPane } from "./SubagentPane";
import { usePageSlots } from "./slots";
import { useTranscriptJumps } from "./use-transcript-jumps";
import { WorktreeDiff } from "./WorktreeDiff";

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
/** `#item-<seq>` or `#item-<branch>:<seq>`: the item a link opens the thread at (#1101 cat 12). */
function itemFromHash(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const m = /^#item-(.+)$/.exec(window.location.hash);
	return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

export function ThreadPage({ id }: { id: string }) {
	const [hashAt] = useState(itemFromHash);
	const run = useInvestigationRun(id, { windowed: { at: hashAt } });
	const win = run.window;
	const { harnesses } = useAgentChoice();
	const resume = useResumeInvestigation();
	const [resumeError, setResumeError] = useState<string | null>(null);
	const [boxOpen, setBoxOpen] = useState(false);
	const search = useSearch({ from: "/_authenticated/threads/$id" });
	const navigate = useNavigate();
	const panelOpen = !!search.panel;
	const [browserOpened, setBrowserOpened] = useState(false);
	const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(new Set());
	const [subagentId, setSubagentId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [focusSignal, setFocusSignal] = useState(0);
	const inv = run.investigation;
	useVisitThread(inv?.id ?? null, !run.isActive);
	usePageTitle(inv?.title ?? "Thread");
	const harness = harnesses.find((h) => h.id === inv?.harness);
	const repo = useRepository(inv?.repositoryId ?? "");
	const service = useService(inv?.repositoryId ? "" : (inv?.serviceId ?? ""));
	const workspace = inv?.workspace;
	const context = useThreadContext(inv?.id ?? null, run.isActive);
	const viewing = useMemo(() => {
		if (!search.path) return null;
		const f = fileFromParam(search.path, workspace);
		return f
			? { ...f, line: search.line ?? f.line, end: search.line ?? f.end }
			: null;
	}, [search.path, search.line, workspace]);

	const items = useMemo(
		() =>
			deriveTranscript(run.events, {
				pending: run.pending,
				...(win
					? {
							prior: {
								agent: win.context.agentBefore,
								ended: win.context.endsBefore > 0,
								operators: win.context.operatorsBefore,
							},
							atTail: !win.hasAfter,
						}
					: {}),
				nodes: hasTranscriptNode,
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
			win?.context,
			win?.hasAfter,
			inv,
			harness,
			harnesses,
		],
	);
	const subagents = useMemo(
		() => deriveSubagents(run.events, { ended: !run.isActive }),
		[run.events, run.isActive],
	);
	const suspects = useMemo(
		() => run.hypotheses ?? recordedFindings(run.events).hypotheses,
		[run.hypotheses, run.events],
	);

	// Opening pushes, so Back closes the panel; moving inside it replaces (#1024).
	const openPanel = useCallback(
		(next: PanelSearch) =>
			void navigate({
				to: ".",
				search: (s: Record<string, unknown>) => ({
					...s,
					panel: undefined,
					section: undefined,
					path: undefined,
					line: undefined,
					...next,
				}),
				replace: panelOpen,
			}),
		[navigate, panelOpen],
	);
	const closePanel = useCallback(() => {
		setSubagentId(null);
		void navigate({
			to: ".",
			search: (s: Record<string, unknown>) => ({
				...s,
				panel: undefined,
				section: undefined,
				path: undefined,
				line: undefined,
			}),
			replace: true,
		});
	}, [navigate]);
	const openFile = useCallback(
		(f: FileAt) =>
			openPanel({
				panel: "changes",
				path: fileParam({ ...f, line: null, end: null }),
				...(f.line ? { line: f.line } : {}),
			}),
		[openPanel],
	);
	const openSubagent = useCallback(
		(sessionId: string) => {
			setSubagentId(sessionId);
			openPanel({ panel: search.panel ?? "thread" });
		},
		[openPanel, search.panel],
	);
	// A sub-agent is never messaged: the quote goes to the main agent's box (ADR 0002 §5).
	const askMain = useCallback((quote: string) => {
		setDraft((d) => quote + d);
		setFocusSignal((n) => n + 1);
	}, []);
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
			onOpen: (f) => openFile(f),
			onClose: () => openPanel({ panel: "changes" }),
			backLabel: "Back to files",
			reads: viewing ? readsOf(viewing, run.steps, workspace) : [],
			codeHost: null,
			stepFile: fileOfStep,
			onOpenHypotheses: () => {},
		}),
		[id, workspace, run.steps, viewing, fileOfStep, openFile, openPanel],
	);

	const { sendMessage } = run;
	const sendWith = useCallback(
		(text: string, fields: { model?: string }) =>
			sendMessage(text, "queue", { kind: "chat", to: fields }),
		[sendMessage],
	);
	const openAsks = useMemo(
		() => run.openAsks ?? pendingAsks(id, run.events),
		[id, run.openAsks, run.events],
	);
	const jumps = useTranscriptJumps(win, run.steps, hashAt, setOpenSteps);
	const transcriptBox = useRef<HTMLDivElement>(null);
	const find = useThreadFind(id, {
		viewportStart: () => jumps.range.first,
		onGo: jumps.goTo,
	});
	const { openFind, close: closeFind, next: findNext, prev: findPrev } = find;
	// A palette hit opens the thread with find at it (`?find=…#item-…`).
	const findParam = search.find;
	const { setQuery: setFindQuery } = find;
	useEffect(() => {
		if (!findParam) return;
		openFind();
		setFindQuery(findParam);
	}, [findParam, openFind, setFindQuery]);
	const findOpen = find.open;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				(e.ctrlKey || e.metaKey) &&
				!e.altKey &&
				e.key.toLowerCase() === "f"
			) {
				e.preventDefault();
				openFind();
			} else if (e.key === "F3" && findOpen) {
				e.preventDefault();
				if (e.shiftKey) findPrev();
				else findNext();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [openFind, findOpen, findNext, findPrev]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: repaint when rows on screen or the window change.
	useEffect(() => {
		paintHighlights(transcriptBox.current, find);
	}, [
		find.open,
		find.query,
		find.caseSensitive,
		find.hits,
		find.current,
		jumps.range,
		win?.version,
		openSteps,
	]);
	const transcriptWindow: TranscriptWindow | undefined = useMemo(
		() =>
			win
				? {
						hasBefore: win.hasBefore,
						hasAfter: win.hasAfter,
						edges: win.edges,
						change: win.change,
						onBefore: () => void win.loadBefore(),
						onAfter: () => void win.loadAfter(),
						folded: win.folded,
						onUnfold: win.unfold,
						target: jumps.target,
						onRange: jumps.setRange,
						messages: win.index?.entries.length ?? 0,
						onToTail: () => void win.toTail(),
						connection: win.connection,
						unsaved: win.unsaved,
						lost: win.lost,
						fullFor: jumps.fullFor,
					}
				: undefined,
		[win, jumps.target, jumps.setRange, jumps.fullFor],
	);
	const slots = usePageSlots({
		page: "thread",
		threadId: inv?.id ?? null,
		incidentId: null,
		live: run.isActive,
		asks: openAsks,
		draft,
		send: sendWith,
	});
	// A finished run's next message may take another model or effort; the run's own until picked (#1024).
	const [nextChoice, setNextChoice] = useState<{
		model?: string;
		effort?: string | null;
	}>({});
	const forward = useCallback(
		async (env: SendEnvelope, now: boolean) => {
			const attachments = await uploadEach(env.attachments, (f) =>
				uploadThreadAttachment({ runId: id }, f),
			);
			await sendMessage(env.text, now ? "now" : "queue", {
				attachments,
				kind: "chat",
				fields: { ...messageFields(env), ...nextChoice },
			});
			setNextChoice({});
		},
		[id, sendMessage, nextChoice],
	);
	const { interceptors } = slots;
	const onSend = useCallback(
		(env: SendEnvelope, now: boolean) =>
			interceptSend(env, now, interceptors, forward),
		[interceptors, forward],
	);
	const threadPath = `/threads/${id}`;
	const links = useMemo(
		() => ({
			threadId: id,
			href: (t: Parameters<typeof hrefOf>[0]) => hrefOf(t, threadPath),
			open: (t: Parameters<typeof hrefOf>[0]) => {
				const place = placeOf(t, hasDesktopBrowser());
				switch (place.to) {
					case "panel":
						return openPanel(place.search);
					case "thread":
						return void navigate({
							to: "/threads/$id",
							params: { id: place.id },
						});
					case "incident":
						return void navigate({
							to: "/incidents/$id",
							params: { id: place.id },
						});
					case "subagent":
						return openSubagent(place.sessionId);
					case "artifact":
						return document
							.querySelector(`[data-artifact-id="${CSS.escape(place.id)}"]`)
							?.scrollIntoView({ block: "center" });
					case "browser":
						desktopBridge()?.browser?.open(place.href);
						setBrowserOpened(true);
						return openPanel({ panel: "browser" });
					case "tab":
						window.open(place.href, "_blank", "noreferrer");
				}
			},
		}),
		[id, threadPath, openPanel, navigate, openSubagent],
	);
	const tabs = panelTabs({
		kind: context.data?.kind ?? null,
		thread: true,
		changes: !!workspace,
		browser: browserOpened && hasDesktopBrowser(),
	});
	const tab = shownTab(tabs, search.panel);
	useEffect(() => {
		if (tab && search.panel) rememberTab(id, tab);
	}, [id, tab, search.panel]);
	const togglePanel = () =>
		panelOpen
			? closePanel()
			: openPanel({ panel: rememberedTab(id) ?? tabs[0]?.id ?? "thread" });
	// Settling clears the view the thread opened (#1024); leaving the page does too.
	useEffect(
		() => () => {
			if (browserOpened) desktopBridge()?.browser?.go("clear");
		},
		[browserOpened],
	);

	const ready = !run.isLoading && !run.error && !!inv;
	const back = inv ? backOf(inv) : backOf({});
	const [tone, word] = !inv
		? (["muted", ""] as const)
		: run.stopRequested
			? (["live", "Stopping"] as const)
			: STATE[inv.status];
	const header = (
		<header
			data-title-row
			className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2"
		>
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
			{workspace?.layout === "folder" && (
				// A plain folder's thread works in the folder itself (#1020).
				<span
					className="inline-flex shrink-0 items-center gap-1 text-meta text-warn"
					data-testid="thread-no-undo"
				>
					<TriangleAlert className="size-3.5" aria-hidden />
					No undo
				</span>
			)}
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
				onToggle={togglePanel}
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
	// Open asks come from the ask record: one outlives the run that opened it (#1024).
	const asks = openAsksOf(run.asks, openAsks);
	const agentLabel = harness?.label ?? "The agent";
	const askDock =
		asks.length > 0 || run.queued.length > 0 ? (
			<RunDock
				asks={asks}
				queued={run.queued}
				runId={inv.id}
				agent={agentLabel}
				cwd={workspace?.cwd}
			/>
		) : null;
	const dock =
		askDock || slots.dock ? (
			<>
				{askDock}
				{slots.dock}
			</>
		) : null;
	const blocked =
		run.ended && !run.resumable && state !== "interrupted"
			? (run.resumeBlockedReason ?? "Can't continue")
			: null;
	const project = repo.data?.fullName ?? service.data?.name ?? null;
	const viewedSubagent = subagents.find((s) => s.sessionId === subagentId);

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
						onOpenDiff={() => openPanel({ panel: "changes" })}
						subagents={subagents}
						onOpenSubagent={openSubagent}
					/>
				</div>
			)}
			{slots.banner}
			<div className="relative min-h-0 flex-1" ref={transcriptBox}>
				<FindBar
					find={find}
					onClose={() => {
						closeFind();
						setFocusSignal((n) => n + 1);
					}}
				/>
				{win?.index && (
					<TranscriptRail
						entries={win.index.entries}
						range={jumps.range}
						hits={find.open ? find.hits.map((h) => h[0]) : []}
						activeHit={find.open ? (find.current?.key ?? null) : null}
						onJump={(key) => void jumps.goTo(key)}
					/>
				)}
				{run.eventsLoading ? (
					<Loading />
				) : items.length ? (
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
						onOpenSubagent={openSubagent}
						links={links}
						window={transcriptWindow}
					/>
				) : (
					<p className="px-5 pt-6 text-body text-text-3">
						{run.isActive ? "Starting the agent" : "Nothing yet"}
					</p>
				)}
			</div>
			{inv.status === "failed" && inv.error && !inv.endReason && (
				// A stopped or interrupted run says so in its dock; any other failure as a sentence (#1101).
				<div
					role="status"
					className="mx-auto flex w-full max-w-[760px] items-start gap-2.5 px-4 text-body"
					data-testid="thread-failure"
				>
					<TriangleAlert
						className="mt-0.5 size-4 shrink-0 text-danger"
						aria-hidden
					/>
					<span>
						{failureStatusLine(agentLabel, inv.error, harness?.loginHint)}
					</span>
				</div>
			)}
			<div className="shrink-0 px-4 pt-2 pb-3">
				<div className="mx-auto w-full max-w-[760px]">
					<Composer
						state={state}
						onSend={onSend}
						scope={`thread:${inv.id}`}
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
							model: nextChoice.model ?? inv.model ?? "",
							effort:
								nextChoice.effort !== undefined
									? nextChoice.effort
									: (inv.effort ?? null),
							accessLevel: (inv.accessLevel ?? "supervised") as AccessLevel,
						}}
						onChoice={(next) => {
							// The thread keeps its agent; another agent is a new thread.
							if (next.harnessId && next.harnessId !== inv.harness) return;
							setNextChoice((c) => ({
								...c,
								...(next.model !== undefined ? { model: next.model } : {}),
								...(next.effort !== undefined ? { effort: next.effort } : {}),
							}));
						}}
						locked={run.isActive}
						accessHint="Kept from the first message"
						dock={dock}
						blockedReason={blocked}
						text={draft}
						onText={setDraft}
						focusSignal={focusSignal}
						footer={slots.composerFooter}
					/>
					{resumeError && (
						<p className="px-3 pt-1 text-meta text-danger" role="alert">
							{resumeError}
						</p>
					)}
				</div>
			</div>
			<RightPanel open={panelOpen} label="Thread panel" onClose={closePanel}>
				<ThreadSidePanel
					tabs={tabs}
					tab={tab}
					onTab={(t: PanelId) => openPanel({ panel: t })}
					onClose={closePanel}
					override={
						viewedSubagent && (
							<SubagentPane
								key={viewedSubagent.sessionId}
								runId={inv.id}
								agent={viewedSubagent}
								events={run.events}
								live={run.isActive}
								onAskMain={askMain}
							/>
						)
					}
					overrideLabel="Sub-agent"
					content={
						tab === "kind" && context.data ? (
							<PanelStack>
								<KindTab context={context.data} />
							</PanelStack>
						) : tab === "changes" ? (
							viewing || search.path ? (
								<FilesPane files={files} onJump={() => {}} />
							) : (
								<div className="flex min-h-0 flex-1 flex-col">
									{files.touched.length > 0 && (
										<div className="shrink-0 shadow-[0_1px_0_var(--hairline)]">
											<FilesPane files={files} onJump={() => {}} />
										</div>
									)}
									{workspace?.layout !== "folder" && (
										<WorktreeDiff runId={inv.id} live={run.isActive} />
									)}
								</div>
							)
						) : tab === "browser" ? (
							<BrowserTab links={[]} />
						) : (
							<ThreadTab
								threadId={inv.id}
								context={context.data}
								live={run.isActive}
								session={inv.session}
								section={search.section}
								focusPr={
									search.section?.startsWith("pull-requests:")
										? search.section.slice("pull-requests:".length)
										: undefined
								}
								steps={
									run.steps.length ? (
										<StepsList
											steps={run.steps}
											files={files}
											onJump={toggleStep}
										/>
									) : undefined
								}
							/>
						)
					}
				/>
			</RightPanel>
		</div>
	);
}
