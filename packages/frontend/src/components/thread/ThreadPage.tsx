// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import {
	AccessLevelSchema,
	compareKeys,
	pendingAsks,
	recordedFindings,
} from "@prismalens/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
	ChevronLeft,
	Columns2,
	PanelRight,
	PanelTop,
	TriangleAlert,
} from "lucide-react";
import {
	type ComponentProps,
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import {
	FollowButton,
	useThreadFollow,
} from "@/components/attention/FollowButton";
import { RunDock } from "@/components/investigation/RunDock";
import { Transcript } from "@/components/investigation/Transcript";
import { hasTranscriptNode } from "@/components/investigation/transcript/registry";
import { unseenLabel } from "@/components/investigation/unseen.surface";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import type { TranscriptWindow } from "@/components/investigation/WindowedTranscript";
import {
	DetailsCard,
	DetailsDock,
	detailsRows,
	dockFor,
	KitPopover,
	Status,
} from "@/components/kit";
import { BlockThread } from "@/components/kit/blocks";
import {
	type EvidenceFiles,
	FilesPane,
	StepsList,
} from "@/components/run/RunDetailsPanel";
import type { RunStep } from "@/components/run/run-steps";
import { AddScheduleFromThread } from "@/components/schedules/schedule-templates";
import { Hint } from "@/components/shared/Hint";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { RightPanel } from "@/components/shell/PanelShell";
import { ThreadMenu } from "@/components/shell/ThreadMenu";
import { StatusLabel } from "@/components/shell/ThreadTree";
import type {
	PageState,
	ThreadPageControls,
} from "@/components/shell/thread.actions";
import { Button } from "@/components/ui/button";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { toast } from "@/hooks/use-toast";
import { useIncident } from "@/lib/api/hooks/use-incidents-orpc";
import {
	useAnswerAsk,
	useResumeInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { useRepository } from "@/lib/api/hooks/use-repositories-orpc";
import { useSchedules } from "@/lib/api/hooks/use-schedules-orpc";
import { useService } from "@/lib/api/hooks/use-services-orpc";
import { useThreadContext } from "@/lib/api/hooks/use-thread-context-orpc";
import { usePanelPullRequests } from "@/lib/api/hooks/use-thread-pull-requests";
import { useThreadLinks } from "@/lib/api/hooks/use-thread-tree-orpc";
import {
	useFeedRow,
	useForkThread,
	useSettleThread,
	useThreadStatuses,
} from "@/lib/api/hooks/use-threads-orpc";
import { useAppCommand } from "@/lib/app-commands";
import { uploadThreadAttachment } from "@/lib/attachments";
import { useOpeningRead, useReadAdvance } from "@/lib/attention/use-attention";
import { onCompose } from "@/lib/compose";
import {
	interceptSend,
	messageFields,
	type SendEnvelope,
	uploadEach,
} from "@/lib/composer-send";
import { desktopBridge } from "@/lib/desktop";
import { type FileAt, readsOf, stepFile } from "@/lib/evidence-files";
import { formatDayClock } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { lazyPart } from "@/lib/lazy";
import { openAsksOf } from "@/lib/run-asks";
import { fileFromParam, fileParam, touchedFiles } from "@/lib/run-panel";
import { matches } from "@/lib/shortcuts";
import { deriveSubagents } from "@/lib/subagents";
import { runStatusInfo, STATUS_WORD } from "@/lib/thread-status";
import { ThreadWindowEvents } from "@/lib/thread-window/window-events-context";
import { readableTitle } from "@/lib/title";
import { cn } from "@/lib/utils";
import { AsideHost, askAside, btwQuestion, onPrimeAside } from "./aside";
import { Composer, type ComposerState } from "./Composer";
import { decidedForYou } from "./composer/AskDock";
import { openNewThread, quoteOf } from "./composer/quote";
import { FindBar } from "./find/FindBar";
import { paintHighlights, useThreadFind } from "./find/use-thread-find";
import { ParentLink } from "./ParentLink";
import { KindTab } from "./panel/KindTab";
import { iconOf, PaneMenu, PaneUnavailable } from "./panel/PaneMenu";
import type { PullRequestView } from "./panel/PullRequests";
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
import { prAnswersOf, ThreadTab } from "./panel/ThreadTab";
import { detailsOf } from "./panel/thread-details";
import { useDetailsCard } from "./panel/use-details-card";
import { cardHasState, useDetailsDocked } from "./panel/use-details-docked";
import { useThreadPanes } from "./panel/use-thread-panes";
import { TranscriptRail } from "./rail/TranscriptRail";
import { StatusBox } from "./StatusBox";
import { SubagentPane } from "./SubagentPane";
import {
	FailedDock,
	failedCause,
	ScheduledFailedDock,
} from "./session/StopDocks";
import { usePageSlots } from "./slots";
import { headerPr, PrSurface, ThreadPrChip } from "./ThreadPrChip";
import { useTranscriptJumps } from "./use-transcript-jumps";

// Panes that bring a diff, highlighting or a browser load when opened (#1101 category 12).
const DiffSurface = lazyPart(
	() => import("./diff/DiffSurface").then((m) => m.DiffSurface),
	<Loading />,
);
const PrFiles = lazyPart(
	() => import("./diff/DiffSurface").then((m) => m.PrFiles),
	<Loading />,
);
const FileView = lazyPart(
	() => import("./diff/FileView").then((m) => m.FileView),
	<Loading />,
);
const PrView = lazyPart(
	() => import("./panel/PrView").then((m) => m.PrView),
	<Loading />,
);
const ThreadBrowser = lazyPart(
	() => import("./panel/HostBrowserPane").then((m) => m.ThreadBrowser),
	<Loading />,
);

/** What Retry sends: the agent takes its failed turn up again in the same session. */
const RETRY_NOTE = "Try that again.";

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
/** A link that opens this thread with one pane shown. */
function paneLink(panel: string): string {
	const url = new URL(window.location.href);
	url.searchParams.set("panel", panel);
	url.searchParams.delete("section");
	url.hash = "";
	return url.toString();
}

function itemFromHash(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const m = /^#item-(.+)$/.exec(window.location.hash);
	return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/** Index entries before the loaded window: the phone's "N earlier" (#1101 category 5). */
function earlierCount(
	entries: readonly (readonly [string, ...unknown[]])[] | undefined,
	lo: string | null,
): number {
	if (!entries || !lo) return 0;
	return entries.filter((e) => compareKeys(e[0], lo) < 0).length;
}

export function ThreadPage({ id }: { id: string }) {
	const [hashAt] = useState(itemFromHash);
	// With no link, the thread opens at its first unseen event (#1101 category 3).
	const run = useInvestigationRun(id, {
		windowed: hashAt ? { at: hashAt } : { position: "unread" },
	});
	const openingRead = useOpeningRead(id);
	const win = run.window;
	const { harnesses } = useAgentChoice();
	const resume = useResumeInvestigation();
	const [resumeError, setResumeError] = useState<string | null>(null);
	const [boxOpen, setBoxOpen] = useState(false);
	// A phone's header keeps the title and folds its controls into ⋯ (#1101 category 5).
	const phone = useMediaQuery(PHONE);
	const search = useSearch({ from: "/_authenticated/threads/$id" });
	const navigate = useNavigate();
	const panelOpen = !!search.panel;
	const [browserOpened, setBrowserOpened] = useState(false);
	const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(new Set());
	const [subagentId, setSubagentId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [focusSignal, setFocusSignal] = useState(0);
	// "Ask the agent to fix" on a PR check or review thread drafts here; you still press Send.
	useEffect(
		() =>
			onCompose((text) => {
				if (text) setDraft(text);
				setFocusSignal((n) => n + 1);
			}),
		[],
	);
	useEffect(
		() =>
			onPrimeAside(id, () => {
				setDraft((d) => (btwQuestion(`${d} x`) ? d : `/btw ${d}`));
				setFocusSignal((n) => n + 1);
			}),
		[id],
	);
	const inv = run.investigation;
	// An alert's thread carries no title of its own: it reads as its incident (#1101).
	const incidentTitle = useIncident(inv?.incidentId ?? "").data?.title;
	const title =
		inv?.title ?? (incidentTitle ? readableTitle(incidentTitle) : "Thread");
	usePageTitle(title);
	const harness = harnesses.find((h) => h.id === inv?.harness);
	const repo = useRepository(inv?.repositoryId ?? "");
	const service = useService(inv?.repositoryId ? "" : (inv?.serviceId ?? ""));
	const workspace = inv?.workspace;
	const context = useThreadContext(inv?.id ?? null, run.isActive);
	const pulls = usePanelPullRequests(
		inv?.id ?? "",
		(context.data?.pullRequests.length ?? 0) > 0 ||
			!!context.data?.workspace?.repos.some((r) => r.branch),
	);
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
							resetsAt: inv.session?.limit?.resetsAt ?? null,
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
	// Up in an empty box recalls the thread's own messages too, on a restored thread (#1101 row 13).
	const recallable = useMemo(
		() =>
			items.flatMap((i) => (i.kind === "operator" ? [i.text] : [])).reverse(),
		[items],
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
					scope: undefined,
					turn: undefined,
					view: undefined,
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
				scope: undefined,
				turn: undefined,
				view: undefined,
				split: undefined,
			}),
			replace: true,
		});
	}, [navigate]);
	const openFile = useCallback(
		(f: FileAt) =>
			openPanel({
				panel: "files",
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
	const feedRow = useFeedRow(id);
	const settleThread = useSettleThread();
	const statuses = useThreadStatuses([id]);
	const declineAsk = useAnswerAsk();
	const jumps = useTranscriptJumps(
		win,
		run.steps,
		hashAt ?? win?.landing ?? undefined,
		setOpenSteps,
	);
	useReadAdvance(
		id,
		jumps.range.last,
		openingRead.isFetched && win?.source === "server",
	);
	const unseen = openingRead.data;
	const divider = useMemo(
		() =>
			unseen?.firstUnseen && unseen.newCount > 0 && unseen.readAt
				? {
						key: unseen.firstUnseen,
						label: unseenLabel(
							unseen.newCount,
							formatDayClock(unseen.readAt, Date.now()),
						),
					}
				: undefined,
		[unseen],
	);
	const transcriptBox = useRef<HTMLDivElement>(null);
	// Slots on this page read the window, never the whole record (#1101 cat 12).
	const windowEvents = useMemo(
		() => (win ? { threadId: id, events: run.events } : null),
		[win, id, run.events],
	);
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
	useAppCommand("find", openFind);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (matches(e, "app.find")) {
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
						earlier: earlierCount(win.index?.entries, win.store.lo),
						onToTail: () => void win.toTail(),
						connection: win.connection,
						unsaved: win.unsaved,
						lost: win.lost,
						fullFor: jumps.fullFor,
						divider,
					}
				: undefined,
		[win, jumps.target, jumps.setRange, jumps.fullFor, divider],
	);
	const decided = useMemo(() => decidedForYou(run.events), [run.events]);
	const agentSaid = useMemo(() => {
		for (let i = run.events.length - 1; i >= 0; i--) {
			const e = run.events[i];
			if (e?.kind === "agent_step" && e.text.trim()) return e.text.trim();
		}
		return undefined;
	}, [run.events]);
	const slots = usePageSlots({
		page: "thread",
		threadId: inv?.id ?? null,
		incidentId: null,
		live: run.isActive,
		asks: openAsks,
		decided,
		agentSaid,
		draft,
		send: sendWith,
	});
	// A finished run's next message may take another model or effort; the run's own until picked (#1024).
	const [nextChoice, setNextChoice] = useState<{
		model?: string;
		effort?: string | null;
	}>({});
	// A thread that kept no workspace can't take a follow-up: a send forks it into a fresh one.
	const fork = useForkThread();
	const startsFresh =
		!!inv &&
		run.ended &&
		!run.resumable &&
		inv.endReason !== "interrupted" &&
		!inv.incidentId &&
		!inv.scheduleId;
	const forward = useCallback(
		async (env: SendEnvelope, now: boolean) => {
			if (startsFresh) {
				if (env.attachments.length)
					throw new Error("Files can't start a new thread from here yet.");
				const forked = await fork.mutateAsync({
					id,
					mode: "fork",
					text: env.text,
					...(env.quotes.length ? { quotes: env.quotes } : {}),
				});
				await navigate({
					to: "/threads/$id",
					params: { id: forked.investigationId },
				});
				return;
			}
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
		[id, sendMessage, nextChoice, startsFresh, fork, navigate],
	);
	const { interceptors } = slots;
	const onSend = useCallback(
		(env: SendEnvelope, now: boolean) =>
			interceptSend(env, now, interceptors, forward),
		[interceptors, forward],
	);
	const [retrying, setRetrying] = useState(false);
	const retry = useCallback(() => {
		setRetrying(true);
		const env = {
			text: RETRY_NOTE,
			attachments: [],
			quotes: [],
			references: [],
		};
		void onSend(env, false).finally(() => setRetrying(false));
	}, [onSend]);
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
	const baseTabs = panelTabs({
		kind: context.data?.kind ?? null,
		thread: true,
		changes: !!workspace,
		files: !!workspace,
		browser: browserOpened,
	});
	const panes = useThreadPanes({
		threadId: id,
		tabs: baseTabs,
		workspace: !!workspace && workspace.layout !== "folder",
		desktopBrowser: hasDesktopBrowser(),
		onOpen: (t) => openPanel({ panel: t }),
	});
	const tabs = panelTabs({
		kind: context.data?.kind ?? null,
		thread: true,
		changes: !!workspace,
		files: !!workspace,
		browser: browserOpened || panes.layout.opened.includes("browser"),
	});
	const tab = shownTab(tabs, search.panel);
	const splitId =
		search.split ??
		(panes.layout.split !== tab ? panes.layout.split : null) ??
		null;
	const splitTab = splitId ? tabs.find((t) => t.id === splitId) : undefined;
	useEffect(() => {
		if (tab && search.panel) rememberTab(id, tab);
	}, [id, tab, search.panel]);
	// With no pane open the card is the right side; the toggle docks or closes it (sheet §9.5).
	const [docked, setDocked] = useDetailsDocked();
	// Too narrow to dock beside the transcript: the header's toggle opens the card instead.
	const [areaW, setAreaW] = useState(0);
	const areaRef = useCallback((el: HTMLDivElement | null) => {
		if (!el || typeof ResizeObserver === "undefined") return;
		new ResizeObserver(([e]) => setAreaW(e.contentRect.width)).observe(el);
	}, []);
	const wide = areaW === 0 || dockFor(areaW) === "docked";
	// A card holding only the agent and the machine says nothing about the thread: it stays
	// shut until asked for (#1101); the user's own docking choice still sticks.
	const [askedForCard, setAskedForCard] = useState(false);
	const toggleDetails = () => {
		if (panelOpen) return closePanel();
		if (cardShown) {
			setAskedForCard(false);
			return setDocked(false);
		}
		setAskedForCard(true);
		setDocked(true);
	};
	const startLinks = useThreadLinks(id, run.isActive);
	const card = useDetailsCard({
		threadId: id,
		context: context.data,
		workspace,
		pulls: pulls.data,
		terminal: panes.tools.some((t) => t.id === "terminal" && !t.unavailable),
		openPr: (pr) =>
			openPanel({
				panel: "thread",
				section: pr ? `pull-requests:${pr.id}` : "pull-requests",
			}),
		openTerminal: () => panes.open("terminal"),
		openStarted: () => openPanel({ panel: "thread", section: "threads" }),
		filterStarted: () =>
			void navigate({
				to: ".",
				search: (prev: Record<string, unknown>) => ({ ...prev, by: id }),
			} as never),
	});
	const detailRows = context.data
		? detailsRows(
				detailsOf({
					context: context.data,
					links: startLinks.data,
					agentLabel: harness?.label ?? null,
					actions: card.actions,
					started: card.started,
					open: {
						diff: workspace ? () => openPanel({ panel: "changes" }) : undefined,
						pr: () => openPanel({ panel: "thread", section: "pull-requests" }),
						startedBy: startLinks.data?.startedBy
							? () => {
									const by = startLinks.data?.startedBy;
									if (by)
										void navigate({
											to: "/threads/$id",
											params: { id: by.id },
										});
								}
							: undefined,
						kind: () => openPanel({ panel: "kind" }),
					},
				}),
			)
		: null;
	const cardShown = docked && (askedForCard || cardHasState(detailRows));
	const paneMenu = (
		<PaneMenu
			tools={panes.tools}
			onOpen={panes.open}
			onTile={panelOpen ? tilePane : undefined}
			trigger={
				<button
					type="button"
					aria-label="Open a pane"
					className="flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 data-[state=open]:bg-surface-3"
					data-testid="pane-menu"
				>
					<Columns2 className="size-4" aria-hidden />
				</button>
			}
		/>
	);
	// Settling clears the view the thread opened (#1024); leaving the page does too.
	useEffect(
		() => () => {
			if (browserOpened) desktopBridge()?.browser?.go("clear");
		},
		[browserOpened],
	);

	function tilePane(t: PanelId | "terminal") {
		if (t === "terminal") return;
		const top = tab ?? rememberedTab(id) ?? "thread";
		panes.setLayout((l) => ({
			...l,
			split: t,
			opened: l.opened.includes(t) ? l.opened : [...l.opened, t],
		}));
		openPanel({ panel: top === t ? "thread" : top, split: t });
	}
	// One renderer per pane, so a tiled pane shows the same body as its tab (#1101 category 21).
	const paneBody = (at: PanelId | null) =>
		at === "kind" && context.data ? (
			<PanelStack>
				<KindTab context={context.data} />
			</PanelStack>
		) : at === "changes" ? (
			!workspace || workspace.layout === "folder" ? (
				<PaneUnavailable
					title="No diff for a folder"
					why="A plain folder has no git history to compare. Files shows what it touched."
					testId="changes-folder"
				/>
			) : (
				<DiffSurface
					runId={id}
					threadId={id}
					live={run.isActive}
					workspace={workspace}
					search={at === tab ? search : { panel: "changes" }}
					onSearch={(next) =>
						openPanel({
							...next,
							panel: "changes",
							...(search.split ? { split: search.split } : {}),
						})
					}
				/>
			)
		) : at === "files" ? (
			workspace && at === tab && viewing ? (
				<FileView
					runId={id}
					threadId={id}
					workspace={workspace}
					repo={viewing.repo}
					path={viewing.path}
					line={viewing.line}
					live={run.isActive}
					onBack={() => openPanel({ panel: "files" })}
					backLabel="Files"
					onShowChanges={() =>
						openPanel({
							panel: "changes",
							path: `${viewing.repo}:${viewing.path}`,
							...(viewing.line ? { line: viewing.line } : {}),
						})
					}
				/>
			) : (
				<FilesPane files={files} onJump={() => {}} />
			)
		) : at === "browser" ? (
			<ThreadBrowser threadId={id} />
		) : (
			<ThreadTab
				threadId={id}
				context={context.data}
				live={run.isActive}
				session={inv?.session}
				section={search.section}
				onOpenPr={(prId) =>
					openPanel({ panel: "thread", section: `pull-requests:${prId}` })
				}
				focusPr={
					search.section?.startsWith("pull-requests:")
						? search.section.slice("pull-requests:".length)
						: undefined
				}
				steps={
					run.steps.length ? (
						<StepsList steps={run.steps} files={files} onJump={toggleStep} />
					) : undefined
				}
			/>
		);

	const ready = !run.isLoading && !run.error && !!inv;
	const back = inv ? backOf(inv) : backOf({});
	const prs = context.data?.pullRequests ?? [];
	const chipPr = headerPr(prs);
	const openPrPanel = (prId: string) =>
		openPanel({ panel: "thread", section: `pull-requests:${prId}` });
	const cardRows = detailRows?.map((r) =>
		r.id === "pr" && chipPr
			? {
					...r,
					wrap: (row: ReactElement) => (
						<PrSurface
							pr={chipPr}
							onOpen={openPrPanel}
							onRefresh={() => void context.refetch()}
						>
							{row}
						</PrSurface>
					),
				}
			: r,
	);
	const prFocus = search.section?.startsWith("pull-requests:")
		? search.section.slice("pull-requests:".length)
		: undefined;
	const viewedPr = prFocus
		? ((pulls.data?.pullRequests ?? prs) as PullRequestView[]).find(
				(p) => p.id === prFocus,
			)
		: undefined;
	// A review thread's path:line lands on that file and line in the diff (cp1 L6a item 1).
	const openPrFile = (
		pr: PullRequestView,
		path: string,
		line: number | null,
	) => {
		const repos = workspace?.repos ?? [];
		const repo =
			repos.find((r) => r.name === pr.repo.split("/").pop()) ??
			(repos.length === 1 ? repos[0] : undefined);
		if (!repo) return openPanel({ panel: "changes" });
		openFile({ repo: repo.name, sha: repo.head, path, line, end: line });
	};
	const statusInfo = inv
		? (statuses.data?.statuses[inv.id] ?? runStatusInfo(inv.status))
		: null;
	const kindTool = panes.tools.find((t) => t.id === "kind");
	const hasPane = (id: string) => panes.tools.some((t) => t.id === id);
	const phoneControls = {
		prLabel: chipPr ? `PR #${chipPr.number}` : "Pull request",
		openPr: () =>
			chipPr &&
			openPanel({ panel: "thread", section: `pull-requests:${chipPr.id}` }),
		details: () => openPanel({ panel: "thread" }),
		openPane: (t: "changes" | "files" | "browser" | "kind") => panes.open(t),
		kindLabel: kindTool?.label ?? "Subject",
		kindIcon: kindTool ? iconOf(kindTool) : PanelRight,
		toggleStatusBox: () => setBoxOpen((o) => !o),
	};
	const phoneFacts: PageFacts = {
		ready,
		hasPr: !!chipPr,
		boxOpen,
		paneChanges: hasPane("changes"),
		paneFiles: hasPane("files"),
		paneBrowser: hasPane("browser"),
		paneKind: !!kindTool,
	};
	const header = (
		<header
			data-title-row
			className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2 max-sm:gap-1 max-sm:pr-1 max-sm:pl-1"
		>
			<Button variant="ghost" size="icon-lg" aria-label={back.label} asChild>
				<Link to={back.to} params={back.params}>
					<ChevronLeft />
				</Link>
			</Button>
			{inv && <ParentLink threadId={inv.id} />}
			<h1
				className="min-w-0 flex-1 truncate text-title"
				data-testid="thread-title"
			>
				{title}
			</h1>
			{workspace?.layout === "folder" && (
				// A plain folder's thread works in the folder itself (#1020).
				<Hint label="No undo" when={phone}>
					<span
						className="inline-flex shrink-0 items-center gap-1 text-meta text-warn"
						data-testid="thread-no-undo"
					>
						<TriangleAlert className="size-3.5" aria-hidden />
						{phone ? <span className="sr-only">No undo</span> : "No undo"}
					</span>
				</Hint>
			)}
			{phone && statusInfo && (
				<Hint label={STATUS_WORD[statusInfo.status]}>
					<span
						className="flex size-11 shrink-0 items-center justify-center"
						data-testid="thread-state"
					>
						<Status kind={statusInfo.status} showWord={false} />
					</span>
				</Hint>
			)}
			{!phone && chipPr && (
				<ThreadPrChip
					pr={chipPr}
					more={prs.length - 1}
					onOpen={(prId) =>
						openPanel({ panel: "thread", section: `pull-requests:${prId}` })
					}
					onRefresh={() => void context.refetch()}
				/>
			)}
			{!phone && statusInfo && (
				// The same closed-set status the list shows (#1101 category 2), the run's own until it loads.
				<span
					className="inline-flex items-center gap-2 text-body text-text-2"
					data-testid="thread-state"
				>
					<StatusLabel info={statusInfo} now={Date.now()} />
					{run.stopRequested && (
						<span className="text-meta text-text-3">Stopping</span>
					)}
				</span>
			)}
			{!phone && inv && (
				<FollowButton threadId={inv.id} running={run.isActive} />
			)}
			{/* One ⋯ at every width; a phone also folds the header's own controls into it. */}
			{inv && (
				<HeaderMenu
					phone={phone}
					threadId={inv.id}
					running={run.isActive}
					controls={phoneControls}
					is={phoneFacts}
					schedule={{
						title: inv.title ?? null,
						subject: inv.repositoryId
							? { kind: "project", repositoryId: inv.repositoryId }
							: inv.serviceId
								? { kind: "service", serviceId: inv.serviceId }
								: { kind: "none" },
						prUrl: chipPr?.url,
					}}
					menu={(page) => (
						<ThreadMenu
							thread={{
								...inv,
								settledAt: feedRow?.settledAt ?? null,
								pinnedAt: feedRow?.pinnedAt ?? null,
								archivedAt: feedRow?.archivedAt ?? null,
							}}
							page={page}
							triggerClassName="flex size-8 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-surface-3 hover:text-text-1 max-sm:size-11"
							{...(!run.isActive && !feedRow?.settledAt
								? {
										onSettle: () =>
											settleThread.mutate(
												{ id: inv.id, settled: true },
												{
													onSuccess: () => toast({ title: "Thread settled" }),
												},
											),
									}
								: {})}
						/>
					)}
				/>
			)}
			{!phone && (
				<>
					<HeaderToggle
						label="Status"
						pressed={boxOpen}
						disabled={!ready}
						onToggle={() => setBoxOpen((o) => !o)}
						icon={<PanelTop className="size-4" aria-hidden />}
						testId="status-box-toggle"
						controls="status-box"
					/>
					{ready && paneMenu}
					{!panelOpen && !wide && detailRows ? (
						<KitPopover
							family="picker"
							align="end"
							label="Details"
							hint="Details"
							trigger={
								<button
									type="button"
									aria-label="Details"
									className="flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 data-[state=open]:bg-surface-3 data-[state=open]:text-text-1"
									data-testid="details-button"
								>
									<PanelRight className="size-4" aria-hidden />
								</button>
							}
						>
							<DetailsCard
								rows={cardRows ?? []}
								className="bg-transparent p-0"
							/>
						</KitPopover>
					) : (
						<HeaderToggle
							label={
								panelOpen
									? "Close pane"
									: cardShown
										? "Hide details"
										: "Show details"
							}
							pressed={panelOpen || cardShown}
							disabled={!ready}
							onToggle={toggleDetails}
							icon={<PanelRight className="size-4" aria-hidden />}
							testId="panel-toggle"
							controls="thread-panel"
						/>
					)}
				</>
			)}
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
	// Fork from a response: New thread opens with that response quoted, sent as a child (sheet §2).
	const forkable = !(inv.incidentId || inv.scheduleId);
	const forkFrom = (key: string) => {
		const item = items.find((i) => i.key === key);
		if (item?.kind !== "prose") return;
		const chip = quoteOf(item.text, { threadId: inv.id, kind: "transcript" });
		openNewThread({
			quotes: chip ? [chip] : [],
			references: [],
			forkOf: { id: inv.id },
		});
	};
	const agentLabel = harness?.label ?? "The agent";
	const askDock =
		asks.length > 0 || run.queued.length > 0 ? (
			<RunDock
				asks={asks}
				queued={run.queued}
				runId={inv.id}
				agent={agentLabel}
				cwd={workspace?.cwd}
				accessLevel={AccessLevelSchema.safeParse(inv.accessLevel).data ?? null}
			/>
		) : null;
	const blocked =
		!startsFresh && run.ended && !run.resumable && state !== "interrupted"
			? (run.resumeBlockedReason ?? "Can't continue")
			: null;
	// A failed turn says so once, in its dock: the transcript drops its own end line.
	const failedTurn =
		!run.isActive && inv.status === "failed" && !!inv.error && !inv.endReason;
	// The turn's failed end line, even with events (a PR's status) after it; a chat's
	// error end reads "stale", as a message's own end does (investigation-events).
	const failedEndAt = failedTurn
		? items.findLastIndex(
				(i) => i.kind === "end" && (i.tone === "failed" || i.tone === "stale"),
			)
		: -1;
	const shownItems =
		failedEndAt >= 0 ? items.filter((_, i) => i !== failedEndAt) : items;
	const cause = failedCause(agentLabel, inv.error, harness?.loginHint);
	// A scheduled run with no workspace to go back to runs its schedule again.
	const failedDock =
		failedTurn &&
		(blocked && inv.scheduleId ? (
			<ScheduledFailedDock cause={cause} scheduleId={inv.scheduleId} />
		) : (
			<FailedDock
				cause={cause}
				onRetry={blocked ? undefined : retry}
				pending={retrying}
			/>
		));
	const dock =
		askDock || slots.dock || failedDock ? (
			<>
				{askDock}
				{slots.dock}
				{failedDock}
			</>
		) : null;
	const project = repo.data?.fullName ?? service.data?.name ?? null;
	const viewedSubagent = subagents.find((s) => s.sessionId === subagentId);

	const main = (
		<>
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
			<FindBar
				find={find}
				onClose={() => {
					closeFind();
					setFocusSignal((n) => n + 1);
					// A disabled composer cannot take focus: fall back to the transcript.
					requestAnimationFrame(() => {
						if (
							document.activeElement &&
							document.activeElement !== document.body
						)
							return;
						transcriptBox.current
							?.querySelector<HTMLElement>(
								'[data-testid="transcript-scroller"]',
							)
							?.focus();
					});
				}}
			/>
			<div className="relative min-h-0 flex-1" ref={transcriptBox}>
				{win?.index && (
					<TranscriptRail
						entries={win.index.entries}
						range={jumps.range}
						hits={find.open ? find.hits.map((h) => h[0]) : []}
						activeHit={find.open ? (find.current?.key ?? null) : null}
						onJump={(key) => void jumps.goTo(key)}
						working={run.isActive}
						box={transcriptBox}
					/>
				)}
				{run.eventsLoading ? (
					<div className="mx-auto w-full max-w-[760px] px-4 pt-5">
						<Loading rows={5} />
					</div>
				) : win && run.eventsError ? (
					// The open itself failed: say so with Retry, never an empty "Nothing yet".
					<Problem
						text="Couldn't open this thread"
						onRetry={() => void win.reopen()}
					/>
				) : shownItems.length ? (
					<Transcript
						items={shownItems}
						incidentId={null}
						cwd={workspace?.cwd}
						agent={[agentLabel, inv.model].filter(Boolean).join(", ")}
						runName={title}
						chat={inv.kind === "chat"}
						steps={steps}
						runId={inv.id}
						foldTurns={{ live: run.isActive }}
						onOpenSubagent={openSubagent}
						links={links}
						window={transcriptWindow}
						onFork={forkable ? forkFrom : undefined}
					/>
				) : (
					<p className="px-5 pt-6 text-body text-text-3">
						{run.isActive ? "Starting the agent" : "Nothing yet"}
					</p>
				)}
			</div>
			<div className="shrink-0 px-4 pt-2 pb-3 max-md:pb-[calc(0.75rem+var(--kb-inset,0px))]">
				<div className="relative mx-auto w-full max-w-[760px]">
					<AsideHost threadId={inv.id} />
					<Composer
						state={state}
						onSend={(env, now) => {
							// `/btw` asks aside: never into this transcript or its agent's context (sheet §2).
							const btw = btwQuestion(env.text);
							if (btw) {
								const about = env.quotes[0]?.text.slice(0, 1500);
								askAside(
									inv.id,
									about
										? `${btw}

About:
${about}`
										: btw,
								);
								return Promise.resolve("sent" as const);
							}
							// Typing while an ask waits declines it with your words as the reason (#1101 cat 8 item 4).
							const waiting = asks[0];
							if (waiting && env.text.trim() && !env.attachments.length)
								return declineAsk
									.mutateAsync({
										id: inv.id,
										askId: waiting.askId,
										answer: {
											kind: "permission",
											decision: "deny",
											reason: env.text.trim(),
										},
									})
									.then(() => "sent" as const);
							return onSend(env, now);
						}}
						scope={`thread:${inv.id}`}
						recallable={recallable}
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
						placeholder={
							asks.length
								? "Type to decline with feedback"
								: run.isActive
									? "Message the agent"
									: // A send that forks says so on its button; the box always reads Reply.
										"Reply"
						}
						sendLabel={startsFresh ? "Send to a new thread" : undefined}
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
						strip={slots.strip}
						blockedReason={blocked}
						blockedQuiet={!!failedDock}
						text={draft}
						onText={setDraft}
						focusSignal={focusSignal}
						footer={slots.composerFooter}
						usageRing
						context={
							inv.usage
								? {
										used: inv.usage.used,
										canCompact: !!inv.session?.compactCommand,
									}
								: null
						}
					/>
					{resumeError && (
						<p className="px-3 pt-1 text-meta text-danger" role="alert">
							{resumeError}
						</p>
					)}
				</div>
			</div>
		</>
	);

	return (
		<ThreadWindowEvents.Provider value={windowEvents}>
			<BlockThread.Provider value={id}>
				<div className="flex h-full min-h-0 flex-col" data-testid="thread-page">
					{header}
					<div ref={areaRef} className="flex min-h-0 flex-1 flex-col">
						{!panelOpen && cardShown && wide && detailRows ? (
							<DetailsDock
								rows={cardRows ?? detailRows}
								wrapCard={card.wrap}
								onDockedChange={setDocked}
								className="pr-3"
							>
								<div className="flex h-full min-h-0 flex-col">{main}</div>
							</DetailsDock>
						) : (
							main
						)}
					</div>
					<RightPanel
						open={panelOpen}
						label="Thread panel"
						onClose={closePanel}
					>
						<ThreadSidePanel
							tabs={tabs}
							tab={tab}
							onTab={(t: PanelId) => openPanel({ panel: t })}
							onClose={closePanel}
							override={
								viewedSubagent ? (
									<SubagentPane
										key={viewedSubagent.sessionId}
										runId={inv.id}
										agent={viewedSubagent}
										events={run.events}
										live={run.isActive}
										onAskMain={askMain}
									/>
								) : (
									viewedPr && (
										<PrView
											key={viewedPr.id}
											pr={viewedPr}
											initialTab="checks"
											answers={prAnswersOf(context.data)}
											threadId={inv.id}
											onWatch={pulls.watch}
											onOpenFile={openPrFile}
											onBack={() => openPanel({ panel: "thread" })}
											files={
												workspace && workspace.layout !== "folder" ? (
													<PrFiles
														runId={inv.id}
														threadId={inv.id}
														live={run.isActive}
														workspace={workspace}
													/>
												) : undefined
											}
										/>
									)
								)
							}
							overrideLabel={
								viewedSubagent
									? "Sub-agent"
									: viewedPr
										? "Pull request"
										: "Sub-agent"
							}
							paneMenu={paneMenu}
							paneCtx={(p) => ({
								show: () => openPanel({ panel: p }),
								tile: () => tilePane(p),
								close: closePanel,
								link: paneLink(p),
								facts: {
									is: {
										shown: p === tab,
										tileable: p !== tab && p !== splitTab?.id,
									},
								},
							})}
							split={
								splitTab
									? {
											label: splitTab.label,
											content: paneBody(splitTab.id),
											ratio: panes.layout.ratio,
											onRatio: (ratio) =>
												panes.setLayout((l) => ({ ...l, ratio })),
											onClose: () => {
												panes.setLayout((l) => ({ ...l, split: null }));
												openPanel({ panel: tab ?? "thread" });
											},
										}
									: undefined
							}
							content={paneBody(tab)}
						/>
					</RightPanel>
				</div>
			</BlockThread.Provider>
		</ThreadWindowEvents.Provider>
	);
}

type PageFacts = { readonly [S in PageState]?: boolean };

/** A phone header's ⋯: the page's own controls, follow and schedule, then the thread's entries. */
function HeaderMenu({
	phone,
	threadId,
	running,
	controls,
	is,
	schedule,
	menu,
}: {
	phone: boolean;
	threadId: string;
	running: boolean;
	controls: Omit<ThreadPageControls, "notify" | "mute" | "schedule">;
	is: PageFacts;
	schedule: Omit<
		ComponentProps<typeof AddScheduleFromThread>,
		"open" | "onOpenChange"
	>;
	menu: (page: { controls: ThreadPageControls; is: PageFacts }) => ReactNode;
}) {
	const follow = useThreadFollow(threadId);
	const schedules = useSchedules();
	const [scheduling, setScheduling] = useState(false);
	return (
		<>
			{menu({
				controls: {
					...controls,
					notify: () => follow.choose("watch"),
					mute: () => follow.choose("mute"),
					schedule: () => setScheduling(true),
				},
				is: {
					...is,
					phone,
					running,
					watching: follow.follow === "watch",
					muted: follow.follow === "mute",
					canSchedule: !!schedules.data?.canEdit,
				},
			})}
			<AddScheduleFromThread
				{...schedule}
				open={scheduling}
				onOpenChange={setScheduling}
			/>
		</>
	);
}
