// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AccessLevel,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import { compareKeys, pendingAsks } from "@prismalens/contracts";
import { QueryClientContext } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
	ChevronLeft,
	Columns2,
	FileDiff,
	PanelRight,
	TriangleAlert,
} from "lucide-react";
import {
	type ComponentProps,
	type ReactElement,
	type ReactNode,
	startTransition,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { modelName, useAgentChoice } from "@/components/agent/agent-choice";
import { useThreadFollow } from "@/components/attention/thread-follow";
import { Transcript } from "@/components/investigation/Transcript";
import {
	RewindRowsProvider,
	rewindRowsOf,
} from "@/components/investigation/transcript/nodes.rewind";
import { hasTranscriptNode } from "@/components/investigation/transcript/registry";
import { unseenLabel } from "@/components/investigation/unseen.surface";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { ViewLevelSwitch } from "@/components/investigation/ViewLevelSwitch";
import type { TranscriptWindow } from "@/components/investigation/WindowedTranscript";
import { BlockThread } from "@/components/kit/blocks";
import { DetailsCard, DetailsDock } from "@/components/kit/DetailsCard";
import { dockFor } from "@/components/kit/details";
import {
	BOX_H,
	DETAILS_LAYOUT,
	detailsRows,
} from "@/components/kit/details-registry";
import { fact } from "@/components/kit/fact";
import { KitPopover } from "@/components/kit/Popover";
import {
	Status,
	type StatusKind,
	statusShort,
	statusWord,
} from "@/components/kit/Status";
import type { EvidenceFiles } from "@/components/run/RunDetailsPanel";
import type { RunStep } from "@/components/run/run-steps";
import { Hint } from "@/components/shared/Hint";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { FaultBoundary } from "@/components/shell/Fault";
import { RightPanel, useRightPanelWidth } from "@/components/shell/PanelShell";
import { StatusLabel } from "@/components/shell/ThreadTree";
import type {
	PageState,
	ThreadPageControls,
} from "@/components/shell/thread.actions";
import { docksHere } from "@/components/thread/composer/decided";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listenKeys } from "@/hooks/use-global-shortcuts";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { knownAccessLevel } from "@/lib/access-levels";
import { useIncident } from "@/lib/api/hooks/use-incidents-orpc";
import {
	useAnswerAsk,
	useAnsweredHere,
	useHandoffPreview,
	useResumeInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { useRepository } from "@/lib/api/hooks/use-repositories-orpc";
import { useService } from "@/lib/api/hooks/use-services-orpc";
import { useThreadContext } from "@/lib/api/hooks/use-thread-context-orpc";
import { usePanelPullRequests } from "@/lib/api/hooks/use-thread-pull-requests";
import {
	useLinksFollowSubagents,
	useThreadLinks,
} from "@/lib/api/hooks/use-thread-tree-orpc";
import {
	useFeedRow,
	useForkThread,
	useThreadStatuses,
	useVisitThread,
} from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { useAppCommand } from "@/lib/app-commands";
import { uploadThreadAttachment } from "@/lib/attachments";
import { useOpeningRead, useReadAdvance } from "@/lib/attention/use-attention";
import { compose, onCompose } from "@/lib/compose";
import {
	interceptSend,
	messageFields,
	type SendEnvelope,
	uploadEach,
} from "@/lib/composer-send";
import { desktopBridge } from "@/lib/desktop";
import { type FileAt, readsOf, stepFile } from "@/lib/evidence-files";
import {
	firstContentOf,
	later,
	markFirstContent,
	onFirstContent,
} from "@/lib/first-paint";
import { formatClock, formatDayClock } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { lazyPart, useAfterFirstContent, useAfterFirstPaint } from "@/lib/lazy";
import { openAsksOf } from "@/lib/run-asks";
import { fileFromParam, fileParam, touchedFiles } from "@/lib/run-panel";
import { deriveSubagents } from "@/lib/subagents";
import { onPullThread } from "@/lib/thread-pull";
import { useThreadSchemasReady } from "@/lib/thread-schemas-load";
import { afterAnswers, runStatusInfo, statusOf } from "@/lib/thread-status";
import { ThreadWindowEvents } from "@/lib/thread-window/window-events-context";
import { readableTitle } from "@/lib/title";
import { askAside, btwQuestion, onPrimeAside } from "./aside-bus";
import type { ComposerState } from "./Composer";
import { ComposerStandIn } from "./ComposerStandIn";
import { decidedForYou } from "./composer/decided";
import { openNewThread, quoteOf, setItemJumper } from "./composer/quote";
import { scopedChangesOptions } from "./diff/use-scoped-changes";
import type { FindView } from "./find/find-highlight";
import { GitStateChip, GitStateStrip } from "./git/GitStateChip";
import { gitAsk } from "./git/git-state";
import type { GitStateCtx } from "./git/git-state.actions";
import { HeaderToggle } from "./HeaderToggle";
import { ParentLink } from "./ParentLink";
import { PanelStack } from "./panel/PanelStack";
import { iconOf, PaneMenu } from "./panel/PaneMenu";
import type { PullRequestView } from "./panel/PullRequests";
import { hasDesktopBrowser, hrefOf, placeOf } from "./panel/panel-links";
import {
	afterClose,
	arrangeTabs,
	movedOrder,
	PANE_VIEW,
	type PanelId,
	type PanelSearch,
	panelTabs,
	rememberedTab,
	rememberTab,
	shownTab,
} from "./panel/panel-model";
import { prAnswersOf } from "./panel/pr-answers";
import { detailsOf } from "./panel/thread-details";
import { useDetailsCard } from "./panel/use-details-card";
import { useThreadPanes } from "./panel/use-thread-panes";
import {
	FailedDock,
	failedCause,
	ScheduledFailedDock,
	signInOf,
} from "./session/StopDocks";
import { usePageSlots } from "./slots";
import { headerPr, PrSurface, ThreadPrChip } from "./ThreadPrChip";
import { threadLanding } from "./thread-landing";
import { useRewind } from "./use-rewind";
import { useTranscriptJumps } from "./use-transcript-jumps";

/** The confirm loads when an edit, undo or restore opens it, not with the thread's first paint. */
const RewindDialog = lazyPart(
	() => import("./RewindDialog").then((m) => m.RewindDialog),
	null,
	{ now: true },
);

// The thread's first frame is its header, the folded transcript and a stand-in box; the
// composer, docks, rail and menus load after it (#1101 category 12).
const Composer = lazyPart(
	() => import("./Composer").then((m) => m.Composer),
	(p) => (
		<ComposerStandIn
			placeholder={p.placeholder}
			chipRow={!!(p.top || p.branch)}
		/>
	),
);
const FollowButton = lazyPart(
	() =>
		import("@/components/attention/FollowButton").then((m) => m.FollowButton),
	<span className="size-7 shrink-0" aria-hidden />,
	// A header control on screen: the soon lane, not behind every later part on a slow link (#1101 bar 4.7).
);
const RunDock = lazyPart(() =>
	import("@/components/investigation/RunDock").then((m) => m.RunDock),
);
const AsideHost = lazyPart(() => import("./aside").then((m) => m.AsideHost));
/** How long the header waits for the list's status before it shows the run's own. */
const STATUS_WAIT_MS = 1500;
// A pane's own body draws only once the pane opens (#1130).
const NewTabPage = lazyPart(
	() => import("./panel/PaneBodies").then((m) => m.NewTabPage),
	null,
	{ now: true },
);
const PaneUnavailable = lazyPart(
	() => import("./panel/PaneBodies").then((m) => m.PaneUnavailable),
	null,
	{ now: true },
);
// Find's search loads with its bar, on first use; the page holds only whether it is open (#1130).
const FindHost = lazyPart(
	() => import("./find/FindBar").then((m) => m.FindHost),
	null,
	{ now: true },
);
const SettleDialog = lazyPart(() =>
	import("@/components/shell/SettleDialog").then((m) => m.SettleDialog),
);
const TranscriptRail = lazyPart(() =>
	import("./rail/TranscriptRail").then((m) => m.TranscriptRail),
);
const ThreadMenu = lazyPart(
	() => import("@/components/shell/ThreadMenu").then((m) => m.ThreadMenu),
	(p) => <span className={p.triggerClassName} aria-hidden />,
);

// Panes that bring a diff, highlighting or a browser load when opened (#1101 category 12).
// The panel's frame loads when the panel opens; the docked box is the first paint (#1176).
const ThreadSidePanel = lazyPart(
	() => import("./panel/ThreadSidePanel").then((m) => m.ThreadSidePanel),
	<Loading rows={3} />,
	{ now: true },
);
const ThreadTab = lazyPart(
	() => import("./panel/ThreadTab").then((m) => m.ThreadTab),
	<Loading />,
	{ now: true },
);
const KindTab = lazyPart(
	() => import("./panel/KindTab").then((m) => m.KindTab),
	<Loading />,
	{ now: true },
);
const FilesPane = lazyPart(
	() => import("@/components/run/RunDetailsPanel").then((m) => m.FilesPane),
	<Loading />,
	{ now: true },
);
const StepsList = lazyPart(
	() => import("@/components/run/RunDetailsPanel").then((m) => m.StepsList),
	<Loading />,
	{ now: true },
);
const SubagentPane = lazyPart(
	() => import("./SubagentPane").then((m) => m.SubagentPane),
	<Loading />,
	{ now: true },
);
const DiffSurface = lazyPart(
	() => import("./diff/DiffSurface").then((m) => m.DiffSurface),
	<Loading />,
	{ now: true },
);
// On a diff landing the surface imports while this page evaluates, so the first render has it.
if (firstContentOf() === "diff") DiffSurface.preload(true).catch(() => {});
// The diff surface's own late parts (the tree), fetched before the pane opens.
const DiffParts = lazyPart(() =>
	import("./diff/DiffSurface").then(async (m) => {
		await m.preloadDiffParts();
		return () => null;
	}),
);
const FileView = lazyPart(
	() => import("./diff/FileView").then((m) => m.FileView),
	<Loading />,
	{ now: true },
);
const PrView = lazyPart(
	() => import("./panel/PrView").then((m) => m.PrView),
	<Loading />,
	{ now: true },
);
const ThreadBrowser = lazyPart(
	() => import("./panel/HostBrowserPane").then((m) => m.ThreadBrowser),
	<Loading />,
	{ now: true },
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

/** Index entries before the loaded window: the phone's "N earlier" (#1101 category 5). */
function earlierCount(
	entries: readonly (readonly [string, ...unknown[]])[] | undefined,
	lo: string | null,
): number {
	if (!entries || !lo) return 0;
	return entries.filter((e) => compareKeys(e[0], lo) < 0).length;
}

const NO_FIND: FindView = {
	open: false,
	query: "",
	caseSensitive: false,
	hits: [],
	current: null,
};

export function ThreadPage({ id }: { id: string }) {
	// A diff landing draws its tree first; the transcript column keeps its loading rows until
	// then (#1101 category 12).
	const afterFirst = useAfterFirstContent();
	const transcriptWaits = !afterFirst && firstContentOf() === "diff";
	const [landing] = useState(threadLanding);
	// With no link, the thread opens at its first unseen event (#1101 category 3).
	const run = useInvestigationRun(id, {
		windowed: landing,
	});
	const openingRead = useOpeningRead(id);
	const rewind = useRewind();
	const rewindRows = useMemo(() => rewindRowsOf(run.events), [run.events]);
	const win = run.window;
	const { harnesses, effective } = useAgentChoice();
	const resume = useResumeInvestigation();
	const [resumeError, setResumeError] = useState<string | null>(null);
	const [settling, setSettling] = useState(false);
	// This page's own settle or Undo, until the feed row says so too.
	const [settledHere, setSettledHere] = useState<string | null | undefined>(
		undefined,
	);
	// A phone's header keeps the title and folds its controls into ⋯ (#1101 category 5).
	const phone = useMediaQuery(PHONE);
	const search = useSearch({ from: "/_authenticated/threads/$id" });
	const navigate = useNavigate();
	const panelOpen = !!search.panel;
	const [browserOpened, setBrowserOpened] = useState(false);
	const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(new Set());
	const [subagentId, setSubagentId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	// Why a rewind kept its edited text in the box unsent; it goes when the box empties.
	const [keptWhy, setKeptWhy] = useState<string | null>(null);
	const [keptText, setKeptText] = useState<{
		id: number;
		text: string;
	} | null>(null);
	const onDraft = useCallback((t: string) => {
		setDraft(t);
		if (!t.trim()) setKeptWhy(null);
	}, []);
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
	// A write from the panel (a review reply) lands while no run streams: read it once.
	const pullWindow = win?.pull;
	useEffect(
		() => onPullThread((tid) => tid === id && pullWindow?.()),
		[id, pullWindow],
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
	// The rail and the panel's contents render after the transcript paints, in slices (#1101 category 12).
	const settled = useAfterFirstPaint(!run.isLoading && !!inv);
	// Settle's dialog part loads before it is asked for: a slow link adds a round trip.
	useEffect(() => {
		if (settled) void SettleDialog.preload();
	}, [settled]);
	// A diff landing's panel is its first content, so it renders in the first pass.
	const [diffLanding] = useState(() => firstContentOf() === "diff");
	const panelReady = settled || (diffLanding && !run.isLoading && !!inv);
	// An alert's thread carries no title of its own: it reads as its incident (#1101).
	const incidentTitle = useIncident(inv?.incidentId ?? "").data?.title;
	const title =
		inv?.title ?? (incidentTitle ? readableTitle(incidentTitle) : "Thread");
	usePageTitle(title);
	const harness = harnesses.find((h) => h.id === inv?.harness);
	// A thread whose agent never started recorded none: its next send runs the default (#1101 6).
	const boxHarness = inv?.harness ? harness : effective;
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

	const schemasReady = useThreadSchemasReady();
	const items = useMemo(
		() =>
			deriveTranscript(run.events, {
				schemasReady,
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
			schemasReady,
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

	// Opening pushes, so Back closes the panel; moving inside it replaces (#1024).
	// A pane opens in a transition: its first render yields instead of blocking the click (#1130).
	const openPanel = useCallback(
		(next: PanelSearch) =>
			startTransition(
				() =>
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
			),
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
	const answeredHere = useAnsweredHere();
	// An ask this device answered leaves the dock at once, as it leaves the row and count (#1101 cat 8 item 3).
	const openAsks = useMemo(() => {
		const all = run.openAsks ?? pendingAsks(id, run.events);
		const mine = new Set(answeredHere.map((a) => a.askId));
		return mine.size ? all.filter((a) => !mine.has(a.askId)) : all;
	}, [id, run.openAsks, run.events, answeredHere]);
	const feedRow = useFeedRow(id);
	// Opening the thread marks it seen, and again when its run ends (#1101 cat 2.2, 22.2).
	// By the route's id: on a slow link the run may load after the person has left.
	useVisitThread(id, !run.isActive);
	// Read, not required: a page rendered without a provider still draws (tests, previews).
	const queryClient = useContext(QueryClientContext);
	// Settle's preview is read before Settle is picked, so Settle acts on the click (#1101 cat 20).
	const idle = settled && !run.isActive;
	useEffect(() => {
		if (idle)
			void queryClient?.prefetchQuery(
				orpc.threads.settlePreview.queryOptions({ input: { id } }),
			);
	}, [idle, queryClient, id]);
	const statuses = useThreadStatuses([id]);
	const declineAsk = useAnswerAsk();
	const jumps = useTranscriptJumps(
		win,
		run.steps,
		landing.at ?? win?.landing ?? undefined,
		setOpenSteps,
	);
	const { goTo } = jumps;
	useEffect(() => {
		setItemJumper(goTo);
		return () => setItemJumper(null);
	}, [goTo]);
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
	const [findOpen, setFindOpen] = useState(false);
	const [findFocus, setFindFocus] = useState(0);
	const [find, setFind] = useState<FindView>(NO_FIND);
	const findNav = useRef<{ next: () => void; prev: () => void } | null>(null);
	const openFind = useCallback(() => {
		setFindOpen(true);
		setFindFocus((n) => n + 1);
	}, []);
	const closeFind = useCallback(() => {
		setFindOpen(false);
		setFind(NO_FIND);
	}, []);
	// A palette hit opens the thread with find at it (`?find=…#item-…`).
	const findParam = search.find;
	useEffect(() => {
		if (findParam) openFind();
	}, [findParam, openFind]);
	useAppCommand("find", openFind);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "F3" && findOpen) {
				e.preventDefault();
				if (e.shiftKey) findNav.current?.prev();
				else findNav.current?.next();
			}
		};
		return listenKeys(onKey);
	}, [findOpen]);
	// The painter loads the first time find opens, off the first paint; it then also clears
	// the hits when find closes (#1130).
	const findPainted = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: repaint when rows on screen or the window change.
	useEffect(() => {
		if (!find.open && !findPainted.current) return;
		findPainted.current = true;
		const root = transcriptBox.current;
		void import("./find/find-highlight").then((m) =>
			m.paintHighlights(root, find),
		);
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
						trimmed: win.trimmed,
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
						onFollow: win.follow,
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
		/** Another agent: the send hands the thread off to it in a new session (#1166). */
		harness?: HarnessId;
		model?: string;
		effort?: string | null;
	}>({});
	// An accepted follow-up pick is persisted on the thread, so its model is the thread's own (#1166).
	const lastModel = inv?.model ?? null;
	// A thread that kept no workspace can't take a follow-up: a send forks it into a fresh one.
	const fork = useForkThread();
	const startsFresh =
		!!inv &&
		run.ended &&
		!run.resumable &&
		inv.endReason !== "interrupted" &&
		!inv.incidentId;
	// Another agent picked: the preview says what its new session gets, or why it can't (#1166).
	const switchTo = harnesses.find((h) => h.id === nextChoice.harness);
	const previewing = !!switchTo && !run.isActive && !startsFresh;
	const preview = useHandoffPreview(
		inv?.id ?? "",
		nextChoice.harness,
		previewing,
		nextChoice.effort,
	);
	const from = harness?.label ?? inv?.harness ?? "the agent";
	// A status line of five words or fewer; its hover carries the long account.
	const switchLine: { line: string; detail?: string } | null = !switchTo
		? null
		: startsFresh
			? {
					line: `New thread on ${switchTo.label}`,
					detail: `Next send starts a new thread on ${switchTo.label}.`,
				}
			: preview.isError
				? { line: "Couldn't preview the handoff" }
				: preview.data?.route === "return"
					? {
							line: `Back to ${switchTo.label}`,
							detail: `Next send returns to ${switchTo.label}'s own session; it gets only what it missed (${preview.data.carried}).`,
						}
					: preview.data
						? {
								line: `Switches to ${switchTo.label}`,
								detail: `Next send hands off from ${from} to ${switchTo.label} in a new session${
									preview.data.noReturn === "autonomous"
										? ` (${switchTo.label} can start work on its own when its session reopens)`
										: preview.data.noReturn === "default"
											? ", on its default, which its own session can't take"
											: ""
								}. It gets ${preview.data.carried}.`,
							}
						: { line: "Checking the handoff" };
	const modelLine =
		!nextChoice.harness &&
		!startsFresh &&
		nextChoice.model &&
		nextChoice.model !== lastModel
			? {
					line: `Next: ${modelName(harness, nextChoice.model) ?? nextChoice.model}`,
					detail: `Next send switches ${lastModel ? (modelName(harness, lastModel) ?? lastModel) : "its default model"} to ${modelName(harness, nextChoice.model) ?? nextChoice.model}. A new model may not reuse the cached context.`,
				}
			: null;
	const nextLine = run.isActive ? null : (switchLine ?? modelLine);
	// The server refuses a preflight problem too; a failed preview leaves the send to it.
	const switchBlocked = !previewing
		? null
		: preview.data?.preflight
			? `${preview.data.preflight.problem} ${preview.data.preflight.fix}`
			: preview.isPending
				? "Checking the handoff"
				: null;
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
					...nextChoice,
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
				fields: {
					...messageFields(env),
					...nextChoice,
				},
			});
			// The chip's turn and the source's "Cited in" come from the rows this send kept (#1195).
			if (env.quotes.length || env.references.length)
				void queryClient?.invalidateQueries({
					queryKey: orpc.references.citations.key(),
				});
			setNextChoice({});
		},
		[id, sendMessage, nextChoice, startsFresh, fork, navigate, queryClient],
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
	const tabs = arrangeTabs(
		panelTabs({
			kind: context.data?.kind ?? null,
			thread: true,
			changes: !!workspace,
			files: !!workspace,
			browser: browserOpened || panes.layout.opened.includes("browser"),
			newTab: search.panel === "new",
		}),
		panes.layout,
		[search.panel, search.split],
	);
	// A tab asked for again (a link, a key, the pane menu) is no longer closed. Only a new ask
	// counts: closing the shown tab leaves the URL naming it until the next tab's navigation lands.
	const askedBefore = useRef<PanelId[]>([]);
	useEffect(() => {
		const asked = [search.panel, search.split].filter((p): p is PanelId => !!p);
		const fresh = asked.filter((p) => !askedBefore.current.includes(p));
		askedBefore.current = asked;
		if (fresh.length)
			panes.setLayout((l) =>
				l.closed.some((c) => fresh.includes(c))
					? { ...l, closed: l.closed.filter((c) => !fresh.includes(c)) }
					: l,
			);
	}, [search.panel, search.split, panes.setLayout]);
	const panelWidth = useRightPanelWidth();
	useAppCommand(
		"panelExpand",
		() => panelWidth.setFull(!panelWidth.full),
		panelOpen && panelWidth.can,
	);
	const tab = shownTab(tabs, search.panel);
	// A diff landing on a thread with no diff to draw (no worktree, a plain folder) has the
	// transcript as its first content; else the page waits out the hold (#1101 huge.binary).
	const drawsDiff =
		tab === "changes" && !!workspace && workspace.layout !== "folder";
	useEffect(() => {
		if (diffLanding && inv && !drawsDiff) markFirstContent();
	}, [diffLanding, inv, drawsDiff]);
	const splitId =
		search.split ??
		(panes.layout.split !== tab ? panes.layout.split : null) ??
		null;
	const splitTab = splitId ? tabs.find((t) => t.id === splitId) : undefined;
	useEffect(() => {
		if (tab && search.panel) rememberTab(id, tab);
	}, [id, tab, search.panel]);
	// Too narrow to dock the box beside the transcript: the header's button opens it instead.
	const [areaW, setAreaW] = useState(0);
	const areaRef = useCallback((el: HTMLDivElement | null) => {
		if (!el || typeof ResizeObserver === "undefined") return;
		new ResizeObserver(([e]) => setAreaW(e.contentRect.width)).observe(el);
	}, []);
	const wide = areaW === 0 || dockFor(areaW) === "docked";
	// The box is always there beside the transcript; this toggle opens and closes the panel (#1101 cat 21).
	const toggleDetails = () =>
		panelOpen ? closePanel() : openPanel({ panel: "thread" });
	const startLinks = useThreadLinks(id, run.isActive);
	useLinksFollowSubagents(
		id,
		run.isActive
			? subagents.map((s) => `${s.sessionId}:${s.state}`).join(",")
			: "",
	);
	// After a rewrite every cached read of this thread is stale: diff, PR, checks, context.
	const rereadGit = () => {
		void queryClient?.invalidateQueries({
			predicate: (q) => JSON.stringify(q.queryKey).includes(id),
		});
		openPanel({ panel: "changes" });
	};
	const card = useDetailsCard({
		reread: rereadGit,
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
	});
	const detailRows = context.data
		? detailsRows(
				detailsOf({
					context: context.data,
					links: startLinks.data,
					// Git trouble's step is the composer's strip; the box never says it twice.
					actions: context.data.git ? undefined : card.actions,
					folder: card.folder,
					project: repo.data?.fullName ?? service.data?.name ?? null,
					source: workspace?.repos[0]?.url ?? null,
					open: {
						diff: workspace ? () => openPanel({ panel: "changes" }) : undefined,
						// The PR row lands on that PR's checks, as the header chip does (#1101 category 15).
						pr: () => {
							const own = headerPr(context.data?.pullRequests ?? []);
							openPanel({
								panel: "thread",
								section: own ? `pull-requests:${own.id}` : "pull-requests",
							});
						},
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
						started: () => openPanel({ panel: "thread", section: "threads" }),
					},
				}),
			)
		: null;
	const boxLayout = DETAILS_LAYOUT.thread;
	const counted = (context.data?.workspace?.repos ?? []).filter(
		(r) => r.additions !== null && r.deletions !== null,
	);
	const phoneTotals = counted.length
		? {
				added: counted.reduce((n, r) => n + (r.additions ?? 0), 0),
				removed: counted.reduce((n, r) => n + (r.deletions ?? 0), 0),
			}
		: null;
	// The box holds the PR on wide screens; the header carries it when the box gives way.
	const boxShown = !phone && !panelOpen && wide;
	const paneMenu = (
		<PaneMenu
			tools={panes.tools}
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

	/** Closes tabs from their menu; the shown one hands over to the next kept, or the panel closes. */
	function closeTabs(ids: PanelId[]) {
		const { panel: next, split } = afterClose({
			tabs: tabs.map((t) => t.id),
			shown: tab,
			split: search.split,
			closing: ids,
		});
		panes.setLayout((l) => ({
			...l,
			closed: [...l.closed, ...ids.filter((c) => !l.closed.includes(c))],
			split:
				l.split && (ids.includes(l.split) || l.split === next) ? null : l.split,
		}));
		if (!next) closePanel();
		// `split` is passed even when undefined: the URL keeps a split the search leaves out.
		else if (next !== tab || split !== search.split)
			openPanel({ panel: next, split });
	}

	function tilePane(t: PanelId | "terminal") {
		if (t === "terminal") return;
		// From the New tab page, the pane shown before it stays on top.
		const top = (tab !== "new" ? tab : null) ?? rememberedTab(id) ?? "thread";
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
		) : at === "new" ? (
			<NewTabPage
				tools={panes.tools}
				onOpen={panes.open}
				onTile={tilePane}
				onOpenPath={
					workspace?.repos.length
						? ({ path, line }) => {
								const named = workspace.repos.find((r) =>
									path.startsWith(`${r.name}/`),
								);
								const repo = workspace.layout === "multi" && named;
								openPanel({
									panel: "files",
									path: repo
										? `${repo.name}:${path.slice(repo.name.length + 1)}`
										: `${workspace.repos[0]?.name}:${path}`,
									...(line ? { line } : {}),
								});
							}
						: undefined
				}
			/>
		) : (
			<ThreadTab
				threadId={id}
				context={context.data}
				contextFailed={context.isError}
				onRetryContext={() => void context.refetch()}
				harness={harness}
				onOpenSubagent={openSubagent}
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
	// A thread with a PR fetches its view's code before the click (#1101 category 15 item 1).
	useEffect(() => {
		if (chipPr) onFirstContent(() => void PrView.preload().catch(() => {}));
	}, [chipPr]);
	// A thread with a worktree fetches its Changes pane's file list and code in the later lane,
	// so the pane opens from the cache: on the slow link a 1,000-file list is a second (#1130).
	const gitWorkspace = !!workspace && workspace.layout !== "folder";
	useEffect(() => {
		if (!gitWorkspace || !queryClient) return;
		onFirstContent(() => {
			later(() =>
				queryClient.prefetchQuery(scopedChangesOptions(id, "all", undefined)),
			).done.catch(() => {});
			void DiffParts.preload().catch(() => {});
		});
	}, [gitWorkspace, queryClient, id]);
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
							own={context.data?.ownPrIds?.includes(chipPr.id)}
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
		// The review's line in the diff: the Changes pane opens the whole file when the diff lacks it.
		openPanel({
			panel: "changes",
			...(repo ? { path: `${repo.name}:${path}` } : {}),
			...(repo && line ? { line } : {}),
		});
	};
	// Only the server's status shows, its status call's or the list row's: a run's record
	// alone reads a waiting ask as Done (#1101 cat 2 item 1).
	const askInfo = openAsks[0]
		? ({
				status: openAsks[0].kind === "permission" ? "approval" : "question",
			} as const)
		: null;
	const serverInfo = inv
		? (statuses.data?.statuses[inv.id] ??
			(feedRow ? statusOf(feedRow) : askInfo))
		: null;
	// The run's own status stands in once a short wait is up: on a slow link the list's
	// statuses can queue behind a big thread's loads for many seconds (#1101 cat 2).
	const [statusWaitOver, setStatusWaitOver] = useState(false);
	useEffect(() => {
		if (!inv?.id) return;
		const t = setTimeout(() => setStatusWaitOver(true), STATUS_WAIT_MS);
		return () => clearTimeout(t);
	}, [inv?.id]);
	const statusUnknown =
		!!inv &&
		!serverInfo &&
		!statusWaitOver &&
		(statuses.isPending || statuses.isPlaceholderData);
	const statusInfo =
		inv && !statusUnknown
			? afterAnswers(
					inv.id,
					serverInfo ?? runStatusInfo(inv.status, inv.endReason),
					answeredHere,
					openAsks.map((a) => a.askId),
				)
			: null;
	// The server's settled test first: the feed may not hold a settled row after a reload.
	const statusRow = inv ? statuses.data?.statuses[inv.id] : undefined;
	const settledAt =
		settledHere !== undefined
			? settledHere
			: statusRow
				? (statusRow.settledAt ?? null)
				: feedRow?.section === "settled"
					? feedRow.settledAt
					: null;
	// Settled is the list's section, never the server's status: a settled thread at rest reads Settled.
	const statusKind: StatusKind | null = statusInfo
		? settledAt && statusInfo.status === "done"
			? "settled"
			: statusInfo.status
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
		find: openFind,
	};
	const phoneFacts: PageFacts = {
		ready,
		hasPr: !!chipPr,
		paneChanges: hasPane("changes"),
		paneFiles: hasPane("files"),
		paneBrowser: hasPane("browser"),
		paneKind: !!kindTool,
	};
	// The feed answers long before the context on a slow link; its row carries the same state.
	const git = (context.data ? context.data.git : feedRow?.git) ?? null;
	const gitCtx: GitStateCtx | null =
		git && inv
			? {
					git,
					askText: gitAsk(git),
					ask: compose,
					openFiles: () => openPanel({ panel: "changes" }),
					reread: rereadGit,
					settle: () => setSettling(true),
					facts: {
						is: {
							[git.state]: true,
							settleable: !settledAt,
						},
					},
				}
			: null;
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
			{/* One line beside a wide panel, the whole title in its tooltip (#1101 category 16). */}
			<h1
				className="min-w-0 flex-1 truncate text-title"
				title={title}
				data-testid="thread-title"
				{...fact("title")}
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
			{phone && statusKind && (
				// The phone keeps the kit's short word beside the icon; colour never stands alone.
				<span
					className="flex min-h-11 shrink-0 items-center px-1 text-meta"
					data-testid="thread-state"
				>
					<Status
						kind={statusKind}
						word={statusShort(statusKind) ?? statusWord(statusKind)}
					/>
				</span>
			)}
			{gitCtx && <GitStateChip ctx={gitCtx} phone={phone} />}
			{/* The PR rides the phone header too: its icon and number, the checks in its panel (#1101). */}
			{boxShown ? null : chipPr ? (
				<ThreadPrChip
					pr={chipPr}
					more={prs.length - 1}
					onOpen={(prId) =>
						openPanel({ panel: "thread", section: `pull-requests:${prId}` })
					}
					onRefresh={() => void context.refetch()}
					own={context.data?.ownPrIds?.includes(chipPr.id)}
				/>
			) : (
				// Until the context loads, the feed row's PR stands in; it opens the PR list (#1101 bar 15.7).
				!context.data &&
				feedRow?.pr?.checks && (
					<ThreadPrChip
						pr={{
							id: "",
							number: feedRow.pr.number,
							tone: feedRow.pr.tone,
							checks: feedRow.pr.checks,
						}}
						more={(feedRow.pr.count ?? 1) - 1}
						onOpen={() =>
							openPanel({ panel: "thread", section: "pull-requests" })
						}
					/>
				)
			)}
			{statusUnknown && (
				<span
					role="status"
					aria-label="Reading status"
					className="flex h-5 w-16 shrink-0 items-center max-sm:w-8"
					data-testid="thread-state"
					data-state="loading"
				>
					<Skeleton className="h-3 w-full" />
				</span>
			)}
			{!phone && statusInfo && (
				// The same closed-set status the list shows (#1101 category 2), the run's own until it loads.
				<span
					className="inline-flex items-center gap-2 text-body text-text-2"
					data-testid="thread-state"
					{...fact("status")}
				>
					<StatusLabel
						info={statusInfo}
						kind={statusKind ?? statusInfo.status}
						now={Date.now()}
					/>
					{run.stopRequested && (
						<span className="text-meta text-text-3">Stopping</span>
					)}
				</span>
			)}
			{!phone && inv && <ViewLevelSwitch />}
			{!phone && inv && (
				<FollowButton threadId={inv.id} running={run.isActive} />
			)}
			{phone && detailRows && (
				// The box's facts ride the phone header: the change totals, the whole box on a tap (#1101 cat 21).
				<KitPopover
					family="picker"
					align="end"
					label="Details"
					hint="Details"
					trigger={
						<button
							type="button"
							aria-label="Details"
							className="flex min-h-11 shrink-0 items-center gap-1 rounded-control px-1.5 font-mono text-mono text-text-2 tabular-nums data-[state=open]:bg-surface-3"
							data-testid="phone-facts"
						>
							<FileDiff className="size-4 text-text-3" aria-hidden />
							{phoneTotals ? (
								<span>
									<span className="text-ok">+{phoneTotals.added}</span>{" "}
									<span className="text-danger">−{phoneTotals.removed}</span>
								</span>
							) : null}
						</button>
					}
				>
					<DetailsCard
						rows={cardRows ?? []}
						layout={boxLayout}
						fit
						className="bg-transparent p-0"
					/>
				</KitPopover>
			)}
			{/* One ⋯ at every width; a phone also folds the header's own controls into it. */}
			{inv && (
				<HeaderMenu
					phone={phone}
					threadId={inv.id}
					running={run.isActive}
					controls={phoneControls}
					is={phoneFacts}
					menu={(page) => (
						<ThreadMenu
							scheduleFrom={{
								subject: inv.repositoryId
									? { kind: "project", repositoryId: inv.repositoryId }
									: inv.serviceId
										? { kind: "service", serviceId: inv.serviceId }
										: { kind: "none" },
								...(chipPr?.url ? { prUrl: chipPr.url } : {}),
							}}
							thread={{
								...inv,
								settledAt,
								pinnedAt: feedRow?.pinnedAt ?? null,
								archivedAt: feedRow?.archivedAt ?? null,
							}}
							page={page}
							triggerClassName="flex size-8 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-surface-3 hover:text-text-1 max-sm:size-11"
							{...(!settledAt ? { onSettle: () => setSettling(true) } : {})}
							onUnsettled={setSettledHere}
						/>
					)}
				/>
			)}
			{settling && inv && (
				<SettleDialog
					thread={{ id: inv.id, title: inv.title ?? null }}
					onClose={() => setSettling(false)}
					onSettled={setSettledHere}
				/>
			)}
			{!phone && (
				<>
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
								layout={boxLayout}
								className="bg-transparent p-0"
							/>
						</KitPopover>
					) : (
						<HeaderToggle
							label={panelOpen ? "Close pane" : "Open the panel"}
							pressed={panelOpen}
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
				<div className="mx-auto w-full max-w-(--lane-w) px-4 pt-5">
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
	// The composer's ask dock answers the asks that carry the agent's options; this one the rest.
	const inComposer = new Set(openAsks.filter(docksHere).map((a) => a.askId));
	const runAsks = asks.filter((a) => !inComposer.has(a.askId));
	const askDock =
		runAsks.length > 0 || run.queued.length > 0 ? (
			<RunDock
				asks={runAsks}
				queued={run.queued}
				runId={inv.id}
				agent={agentLabel}
				cwd={workspace?.cwd}
				accessLevel={knownAccessLevel(inv.accessLevel)}
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
	// The disk dock names its cause, so the transcript keeps only when it stopped (#1101 cat 23).
	const diskEnd = !run.isActive && inv.endReason === "disk_full";
	const failedEndAt =
		failedTurn || diskEnd
			? items.findLastIndex(
					(i) =>
						i.kind === "end" && (i.tone === "failed" || i.tone === "stale"),
				)
			: -1;
	const endItem = failedEndAt >= 0 ? items[failedEndAt] : undefined;
	// While the limit dock shows, it says the stop; the transcript's same line waits until it goes.
	const limitDocked = !run.isActive && !!inv?.session?.limit;
	const base: typeof items =
		failedEndAt < 0
			? limitDocked
				? items.filter((i) => i.key !== "provider-stop")
				: items
			: diskEnd && endItem?.kind === "end"
				? items.map((it, i) =>
						i === failedEndAt
							? {
									kind: "divider",
									key: "disk-stop",
									text: endItem.at
										? `Stopped at ${formatClock(endItem.at)}, before the agent started`
										: "Stopped before the agent started",
								}
							: it,
					)
				: items.filter((_, i) => i !== failedEndAt);
	// The live line is always last; only it takes the status's quiet time.
	const quiet = statuses.data?.statuses[inv.id];
	const tail = base.at(-1);
	// A start the status already calls quiet reads Quiet, as the header does.
	const quietStart =
		tail?.kind === "line" &&
		tail.key === "starting" &&
		quiet?.status === "working" &&
		quiet.quietSince
			? quiet.quietSince
			: null;
	const kept: typeof items = quietStart
		? [
				...base.slice(0, -1),
				{
					kind: "thinking",
					key: "thinking",
					since: quietStart,
					quiet: quietStart,
				},
			]
		: tail?.kind === "thinking" && quiet
			? [
					...base.slice(0, -1),
					{
						...tail,
						quiet:
							quiet.status === "working" ? (quiet.quietSince ?? null) : null,
					},
				]
			: base;
	// A settled thread ends on the line that says so (#1101 category 20).
	const shownItems: typeof items =
		settledAt && !run.isActive
			? [
					...kept,
					{
						kind: "divider",
						key: "settled",
						text: `Settled ${formatClock(settledAt)}`,
						separator: true,
					},
				]
			: kept;
	// The strip keeps the status and Retry; a cause the agent's last words already say stays in the transcript (#1101 one fact, one place).
	const fullCause = failedCause(agentLabel, inv.error, harness?.loginHint);
	const lastSaid = base.findLast(
		(i) => i.kind === "prose" || i.kind === "line",
	);
	const plain = (t: string) =>
		t
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	const cause =
		fullCause &&
		lastSaid &&
		(lastSaid.kind === "prose" || lastSaid.kind === "line") &&
		plain(lastSaid.text).includes(plain(fullCause))
			? null
			: fullCause;
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
				signIn={signInOf(inv.error, harness?.loginHint)}
			/>
		));
	// The git state's own strip; a run stop or an ask outranks it on the composer's edge (#1101 bar 15).
	const gitDock =
		gitCtx && !askDock && !slots.dock && !failedDock ? (
			<GitStateStrip ctx={gitCtx} />
		) : null;
	const dock =
		askDock || slots.dock || failedDock || gitDock ? (
			<>
				{askDock}
				{slots.dock}
				{failedDock}
				{gitDock}
			</>
		) : null;
	const storedSubagent = startLinks.data?.subagents?.find(
		(s) => s.sessionId === subagentId,
	);
	const viewedSubagent =
		subagents.find((s) => s.sessionId === subagentId) ?? storedSubagent;

	const main = (
		<>
			{slots.banner}
			{findOpen && (
				<FindHost
					threadId={id}
					focus={findFocus}
					seed={findParam ?? null}
					viewportStart={() => jumps.range.first}
					onGo={jumps.goTo}
					onView={setFind}
					nav={findNav}
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
			)}
			<div className="@container relative min-h-0 flex-1" ref={transcriptBox}>
				<FaultBoundary place="transcript">
					{win?.index && settled && (
						<TranscriptRail
							entries={win.index.entries}
							range={jumps.range}
							hits={find.open ? find.hits.map((h) => h[0]) : []}
							activeHit={find.open ? (find.current?.key ?? null) : null}
							onJump={(key) => void jumps.goTo(key)}
							working={run.isActive}
						/>
					)}
					{run.eventsLoading || transcriptWaits ? (
						<div className="mx-auto w-full max-w-(--lane-w) px-4 pt-5">
							<Loading rows={5} />
						</div>
					) : win && run.eventsError ? (
						// The open itself failed: say so with Retry, never an empty "Nothing yet".
						<Problem
							text="Couldn't open this thread"
							onRetry={() => void win.reopen()}
						/>
					) : shownItems.length ? (
						<RewindRowsProvider
							value={{ threadId: inv.id, ...rewindRows, open: rewind.open }}
						>
							<Transcript
								items={shownItems}
								incidentId={null}
								cwd={workspace?.cwd}
								agent={[agentLabel, inv.model].filter(Boolean).join(", ")}
								runName={title}
								chat={inv.kind === "chat"}
								// A thread an agent started opens on its starter's words, never "You" (#1101 cat 10).
								briefBy={
									startLinks.data?.startedBy?.via === "agent"
										? (startLinks.data.startedBy.title ?? "Its starter")
										: undefined
								}
								briefFrom={
									startLinks.data?.startedBy?.via === "agent"
										? startLinks.data.startedBy.id
										: undefined
								}
								steps={steps}
								runId={inv.id}
								foldTurns={{ live: run.isActive }}
								onOpenSubagent={openSubagent}
								links={links}
								window={transcriptWindow}
								onFork={forkable ? forkFrom : undefined}
								status={statusInfo?.status}
								edit={{
									block: run.isActive
										? "running"
										: run.queued.length
											? "queued"
											: null,
									send: (seq, text) => rewind.open({ mode: "edit", seq, text }),
								}}
							/>
						</RewindRowsProvider>
					) : (
						<p className="px-5 pt-6 text-body text-text-3">
							{run.isActive ? "Starting the agent" : "Nothing yet"}
						</p>
					)}
				</FaultBoundary>
			</div>
			<div className="shrink-0 px-4 pt-2 pb-3 max-md:pb-[calc(0.75rem+var(--kb-inset,0px))]">
				<div className="relative mx-auto w-full max-w-(--lane-w)">
					<AsideHost threadId={inv.id} />
					{rewind.target && (
						<RewindDialog
							threadId={inv.id}
							target={rewind.target}
							onClose={rewind.close}
							onKept={(kept) => {
								setKeptText((k) => ({ id: (k?.id ?? 0) + 1, text: kept.text }));
								setKeptWhy(kept.why);
								setFocusSignal((n) => n + 1);
							}}
						/>
					)}
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
							harness:
								harnesses.find((h) => h.id === nextChoice.harness) ??
								boxHarness,
							...(inv.harness
								? { recorded: { agent: inv.harness, model: inv.model } }
								: {}),
							model: nextChoice.model ?? lastModel ?? "",
							effort:
								nextChoice.effort !== undefined
									? nextChoice.effort
									: (inv.effort ?? null),
							accessLevel: (inv.accessLevel ?? "supervised") as AccessLevel,
						}}
						onChoice={(next) => {
							// Another agent takes the thread over at the next send; its own model, its own effort.
							// Effort resets only when the agent does; a pick on the same agent keeps it.
							if (
								next.harnessId &&
								next.harnessId !== (nextChoice.harness ?? boxHarness?.id)
							) {
								const other = next.harnessId !== boxHarness?.id;
								setNextChoice({
									...(other ? { harness: next.harnessId } : {}),
									...(next.model !== undefined ? { model: next.model } : {}),
								});
								return;
							}
							setNextChoice((c) => ({
								...c,
								...(next.model !== undefined ? { model: next.model } : {}),
								...(next.effort !== undefined ? { effort: next.effort } : {}),
							}));
						}}
						locked={run.isActive}
						nextSession={nextLine?.line ?? null}
						nextSessionDetail={nextLine?.detail ?? null}
						sharedSetFrom={
							run.isActive || nextLine
								? null
								: { events: run.events, harness: inv?.harness }
						}
						accessHint="Kept from the first message"
						dock={dock}
						strip={slots.strip}
						blockedReason={blocked ?? switchBlocked}
						blockedQuiet={!!failedDock}
						text={draft}
						onText={onDraft}
						append={keptText}
						notice={keptWhy ?? undefined}
						focusSignal={focusSignal}
						footer={slots.composerFooter}
						usageRing
						context={
							inv.usage
								? {
										used: inv.usage.used,
										size: inv.usage.size,
										autoAt: inv.harness
											? HARNESS_REGISTRY[inv.harness as HarnessId]
													?.autoCompactPercent
											: null,
										canCompact: !!inv.session?.compactCommand,
										canFresh: !run.isActive,
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
						{/* Always the dock, so opening a pane never remounts the transcript and composer (#1130). */}
						<DetailsDock
							off={phone || panelOpen}
							rows={cardRows ?? null}
							layout={boxLayout}
							height={BOX_H}
							wrapCard={card.wrap}
							className="pr-3"
						>
							<div className="flex h-full min-h-0 flex-col">{main}</div>
						</DetailsDock>
					</div>
					<RightPanel
						open={panelOpen}
						label="Thread panel"
						onClose={closePanel}
					>
						<FaultBoundary place="panel">
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
												// Only a kept workspace has the diff a line opens in.
												onOpenFile={
													workspace?.repos?.length ? openPrFile : undefined
												}
												onBack={() => openPanel({ panel: "thread" })}
												own={context.data?.ownPrIds?.includes(viewedPr.id)}
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
								onNewTab={() =>
									openPanel({
										panel: "new",
										...(search.split ? { split: search.split } : {}),
									})
								}
								paneCtx={(p) => ({
									show: () => openPanel({ panel: p }),
									tile: () => tilePane(p),
									close: closePanel,
									closeTab: () => closeTabs([p]),
									closeOthers: () => {
										closeTabs(tabs.map((t) => t.id).filter((t) => t !== p));
										if (p !== tab) openPanel({ panel: p });
									},
									move: (by) =>
										panes.setLayout((l) => ({
											...l,
											order: movedOrder(
												tabs.map((t) => t.id),
												p,
												by,
											),
										})),
									widen: () => panelWidth.setFull(!panelWidth.full),
									link: paneLink(p),
									facts: {
										is: {
											others: tabs.length > 1,
											first: tabs[0]?.id === p,
											last: tabs.at(-1)?.id === p,
											shown: p === tab,
											tileable:
												PANE_VIEW[p].tile && p !== tab && p !== splitTab?.id,
											wide: panelWidth.full,
											widenable: panelWidth.can,
										},
									},
								})}
								split={
									splitTab
										? {
												label: splitTab.label,
												content: panelReady ? (
													paneBody(splitTab.id)
												) : (
													<Loading />
												),
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
								content={panelReady ? paneBody(tab) : <Loading />}
							/>
						</FaultBoundary>
					</RightPanel>
				</div>
			</BlockThread.Provider>
		</ThreadWindowEvents.Provider>
	);
}

type PageFacts = { readonly [S in PageState]?: boolean };

/** A phone header's ⋯: the page's own controls and follow, then the thread's entries. */
function HeaderMenu({
	phone,
	threadId,
	running,
	controls,
	is,
	menu,
}: {
	phone: boolean;
	threadId: string;
	running: boolean;
	controls: Omit<ThreadPageControls, "notify" | "mute">;
	is: PageFacts;
	menu: (page: { controls: ThreadPageControls; is: PageFacts }) => ReactNode;
}) {
	const follow = useThreadFollow(threadId);
	return (
		<>
			{menu({
				controls: {
					...controls,
					notify: () => follow.choose("watch"),
					mute: () => follow.choose("mute"),
				},
				is: {
					...is,
					phone,
					running,
					watching: follow.follow === "watch",
					muted: follow.follow === "mute",
				},
			})}
		</>
	);
}
