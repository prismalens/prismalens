// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	compareKeys,
	isNeedsYou,
	type LinkTarget,
	STOP_REASONS,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Brain, CircleCheck, FileText, Wrench, X } from "lucide-react";
import {
	createContext,
	Fragment,
	memo,
	type ReactElement,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai/conversation";
import { type MessageLinks, MessageResponse } from "@/components/ai/message";
import { messageCtx } from "@/components/investigation/message.actions";
import { AskCard } from "@/components/investigation/RunDock";
import { errorDetailBlock } from "@/components/investigation/transcript.blocks";
import { Block } from "@/components/kit/Block";
import { Mark } from "@/components/kit/Mark";
import { ResponseActions } from "@/components/kit/ResponseActions";
import { Status, type StatusKind } from "@/components/kit/Status";
import { Surface } from "@/components/kit/Surface";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { ArtifactCard } from "@/components/run/ArtifactCard";
import { PlMark } from "@/components/run/PlMark";
import type { RunStep } from "@/components/run/run-steps";
import { StepCard } from "@/components/run/StepCard";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { StateWord } from "@/components/shared/StateWord";
import { SubagentNode } from "@/components/thread/SubagentNode";
import { CommandChip } from "@/components/ui/command-chip";
import { useSecondClock } from "@/hooks/use-clock";
import { useResolvedLinks } from "@/lib/api/hooks/use-thread-context-orpc";
import { compose } from "@/lib/compose";
import { sizeWord } from "@/lib/evidence-files";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock, formatElapsed } from "@/lib/format-time";
import {
	type AttachmentView,
	OPERATOR_STATE_LABEL,
	type OperatorState,
	STALE_AFTER_S,
	seconds,
	type TranscriptItem,
} from "@/lib/investigation-events";
import { linkCandidates, linkify, targetsByText } from "@/lib/link-candidates";
import { copySelectionAsMarkdown } from "@/lib/markdown";
import { plLabel } from "@/lib/pl-tools";
import { useRenderProbe } from "@/lib/render-probe";
import { shortPath } from "@/lib/report-view";
import { restartSent } from "@/lib/restart";
import { type AskRecord, askEnd, askTitle, askWho } from "@/lib/run-asks";
import {
	NODE_ICON,
	statusWord,
	type TurnFold,
	turnFolds,
	workedLabel,
} from "@/lib/spine";
import { type TurnSummary, turnSummary } from "@/lib/turn-summary";
import { cn } from "@/lib/utils";
import { TurnEnd, type TurnSeq } from "./TurnEnd";
import { InboundRowView } from "./transcript/InboundRow";
import { TranscriptNode } from "./transcript/registry";
import {
	itemEventKey,
	RemoteFoldToggle,
	ShowFull,
	type TranscriptRowNode,
	type TranscriptWindow,
	WindowedTranscript,
} from "./WindowedTranscript";

export { unfence } from "@/components/run/run-steps";

const ENTER =
	"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200";

const LEVEL_TEST_ID = {
	allowed: "transcript-allowed",
	mode_kept: "transcript-mode-kept",
	unattended: "transcript-unattended",
} as const;

/** A group longer than this shows its ends and folds the middle (#811, very long step lists). */
/** The statuses a run's stop can leave a thread in that need you (contracts STOP_REASONS). */
const STOP_KINDS: ReadonlySet<StatusKind> = new Set(
	Object.values(STOP_REASONS)
		.map((r) => r.status)
		.filter(isNeedsYou),
);

const FOLD_OVER = 8;
const FOLD_KEEP = 3;

/** A message sent with Ctrl+Enter: drawn as the delivery mark's arrow, the word in its hint. */
const STEERED_WORD = "sent now";

/** The delivery word beside a message (decision 18): Enter waits for the agent's next pause. */
function deliveryWord(
	state: OperatorState,
	mode: "queue" | "now",
	waitingOn?: "limit",
): string {
	if (state === "queued" && waitingOn === "limit")
		return "waiting for the limit";
	if (state === "not_delivered") return "not delivered";
	if (state === "started" || state === "resumed" || state === "asked")
		return OPERATOR_STATE_LABEL[state].toLowerCase();
	if (state === "queued") return "waits for the next pause";
	if (state === "answered") return "answered";
	return mode === "now" ? STEERED_WORD : "delivered at the next pause";
}

/** What the page tells the transcript about its steps; absent, tool calls read as plain steps. */
export interface TranscriptSteps {
	all: RunStep[];
	open: ReadonlySet<number>;
	onToggle: (n: number) => void;
	highlight: number | null;
	flagged: ReadonlySet<number>;
	onSeeFlag?: () => void;
	/** The run's asks, each on its step (#820). */
	asks?: readonly AskRecord[];
	/** A read step's file at the run's commit, and opening it. */
	fileOf?: (s: RunStep) => { sha: string } | null;
	onOpenFile?: (s: RunStep) => void;
}

/** Once a report exists, the work between the brief and the report folds behind one row. */
export interface WorkedFold {
	seconds: number;
	steps: number;
	open: boolean;
	onToggle: () => void;
}

const NONE: ReadonlySet<number> = new Set();

/** A tool group's own steps, and the ask on each; kept by identity while unchanged. */
interface GroupSteps {
	own: RunStep[];
	asks: (AskRecord | undefined)[];
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Each tool group's lookups, so a memoized row sees new props only when its own steps change (#874). */
function useGroupSteps(
	items: TranscriptItem[],
	steps: TranscriptSteps | undefined,
): Map<string, GroupSteps> {
	const cache = useRef(new Map<string, GroupSteps>());
	const all = steps?.all;
	const allAsks = steps?.asks;
	return useMemo(() => {
		const byCall = new Map(all?.map((s) => [s.callId, s]));
		const next = new Map<string, GroupSteps>();
		for (const item of items) {
			if (item.kind !== "tools") continue;
			const own = item.callIds.flatMap((id) => byCall.get(id) ?? []);
			const asks = own.map((s) => allAsks?.findLast((a) => a.step === s.n));
			const prev = cache.current.get(item.key);
			next.set(
				item.key,
				prev && sameList(prev.own, own) && sameList(prev.asks, asks)
					? prev
					: { own, asks },
			);
		}
		cache.current = next;
		return next;
	}, [items, all, allAsks]);
}

/**
 * A run's transcript (#811): the brief and your messages on the right,
 * the agent's prose, each tool call a numbered step, and how the run ended.
 * A pane: it scrolls itself and follows the tail while live.
 */
export const Transcript = memo(function Transcript({
	items,
	incidentId,
	cwd,
	agent,
	steps,
	runName,
	briefBy = "You",
	report,
	empty,
	worked,
	afterReport,
	lead,
	loginHint,
	limits,
	summaryAbove,
	runId,
	foldTurns,
	chat = false,
	onOpenSubagent,
	links,
	window,
	onFork,
	status,
}: {
	/**
	 * The thread's one status, the header's own: the run's last end draws its word from it,
	 * so a Blocked thread never reads "Run failed" below a Blocked header (#1101).
	 */
	status?: StatusKind;
	/** Prose links resolve against this thread and open through the page (#1024). */
	links?: TranscriptLinks;
	/** A long thread read in windows: rows are virtualized and pages load at the edges (#1101). */
	window?: TranscriptWindow;
	/** Fork a new thread from this response; the row shows Fork only when it is set. */
	onFork?: (itemKey: string) => void;
	items: TranscriptItem[];
	/** Null on a scheduled check no finding has linked yet (#979). */
	incidentId: string | null;
	/** The run's workspace, shown as `repo/` (walk f16). */
	cwd?: string | null;
	agent: string;
	steps?: TranscriptSteps;
	/** `Run 2`, in the brief's line and the report card. */
	runName?: string;
	/** Who wrote the brief: you, or PrismaLens when the alert started the run. */
	briefBy?: string;
	/** The report card's title and summary, when the run reported. */
	report?: {
		title: string;
		summary: string;
		/** The first way to stop the impact, with its command; null says it named none. */
		stop?: { title: string; command?: string } | null;
		/** The report's lasting fix; null says it named none. */
		lasting?: string | null;
	} | null;
	/** What shows before anything is sent: the new conversation's box. */
	empty?: boolean;
	/** The agent's sign-in line, so a signed-out failure names its command. */
	loginHint?: string;
	/** What the run could not read, said beside its conclusion (#1020). */
	limits?: string | null;
	/** An incident summary above already states the cause and the next action. */
	summaryAbove?: boolean;
	worked?: WorkedFold | null;
	/** Drawn right under the report card, outside the fold: the hypotheses card. */
	afterReport?: ReactNode;
	/** The first node: what started the thread, when it came from the world (#1020). */
	lead?: ReactNode;
	/** The run a waiting ask's inline card answers (#1020). */
	runId?: string;
	/** Each finished turn's work folds behind `Worked for …`; the answer stays out (#1020). */
	foldTurns?: { live: boolean };
	/** A thread that owes an answer: its first message is a message, never a brief (#1020). */
	chat?: boolean;
	/** Opens one sub-agent's read-only view (#1025). */
	onOpenSubagent?: (sessionId: string) => void;
}) {
	useRenderProbe("Transcript", { items, steps, worked, report });
	useEffect(() => {
		document.addEventListener("copy", copySelectionAsMarkdown);
		return () => document.removeEventListener("copy", copySelectionAsMarkdown);
	}, []);
	const groups = useGroupSteps(items, steps);
	const brief = items.findIndex(
		(i) => i.kind === "operator" && i.state === "started",
	);
	const end = items.findIndex((i) => i.kind === "end" && i.report);
	const folds = !!worked && end > brief + 1;
	const live = foldTurns?.live;
	const turns = useMemo(
		() => (live === undefined ? [] : turnFolds(items, live)),
		[items, live],
	);
	const ends = useMemo(
		() => turnEnds(items, groups, live ?? false),
		[items, groups, live],
	);
	const [openTurns, setOpenTurns] = useState<ReadonlySet<string>>(new Set());
	const { turnAt, turnHidden } = useMemo(() => {
		const turnAt = new Map<number, TurnFold>();
		const turnHidden = new Set<number>();
		for (const t of turns) {
			turnAt.set(t.at, t);
			if (!openTurns.has(t.key)) for (const i of t.hidden) turnHidden.add(i);
		}
		return { turnAt, turnHidden };
	}, [turns, openTurns]);
	const toggleTurn = (key: string) =>
		setOpenTurns((o) => {
			const next = new Set(o);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	// A jump to an item inside a finished turn's fold opens the fold (#1101 cat 13).
	const jumpKey = window?.target?.key;
	const jumpNonce = window?.target?.nonce;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new nonce repeats the jump.
	useEffect(() => {
		if (!jumpKey) return;
		let at = -1;
		items.forEach((item, i) => {
			const k = itemEventKey(item.key);
			if (k && compareKeys(k, jumpKey) <= 0) at = i;
		});
		const fold = turns.find((t) => t.hidden.includes(at));
		if (fold && !openTurns.has(fold.key))
			setOpenTurns((o) => new Set(o).add(fold.key));
	}, [jumpKey, jumpNonce]);
	// A message still streaming is not resolved: its text keeps changing.
	const liveProse = live
		? items.findLast((i) => i.kind === "prose")?.key
		: undefined;
	const linkValue = useMemo(
		() => (links ? { ...links, liveProse } : null),
		[links, liveProse],
	);
	// A response ends at its last prose before your next message or the run's end.
	const responseEnds = new Set<string>();
	let atEnd = true;
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.kind === "operator" || it.kind === "end") atEnd = true;
		else if (it.kind === "prose" && it.text) {
			if (atEnd && it.key !== liveProse) responseEnds.add(it.key);
			atEnd = false;
		}
	}
	// One row per node, so the same list renders whole or windowed (#1101 cat 12).
	const rows: TranscriptRowNode[] = [];
	if (lead) rows.push({ key: "lead", at: null, node: lead, keep: true });
	if (folds && worked && brief === -1)
		rows.push({
			key: "worked-top",
			at: null,
			node: <WorkedToggle worked={worked} />,
		});
	const lastEnd = items.findLastIndex((x) => x.kind === "end");
	items.forEach((item, i) => {
		const group = groups.get(item.key);
		const has = (set: ReadonlySet<number> | undefined) =>
			set && group?.own.some((s) => set.has(s.n)) ? set : NONE;
		const lit = steps?.highlight ?? null;
		const at = itemEventKey(item.key);
		const turn = turnAt.get(i);
		// A turn the server sent folded draws its own toggle; the local fold would repeat it.
		const remoteTurn =
			!!turn && !!window?.folded.has(itemEventKey(turn.key.slice(5)) ?? "");
		if (turn && !remoteTurn)
			rows.push({
				key: `${item.key}:turn`,
				at,
				node: (
					<TurnToggle
						fold={turn}
						open={openTurns.has(turn.key)}
						onToggle={toggleTurn}
					/>
				),
			});
		const shown =
			!turnHidden.has(i) &&
			(!folds ||
				worked?.open ||
				i <= brief ||
				i >= end ||
				item.kind === "artifact" ||
				// An incoming message's outcome is a result, never folded into the work (sheet §10).
				item.kind === "inbound");
		if (shown)
			rows.push({
				key: item.key,
				at,
				node: (
					<TranscriptRow
						item={item}
						incidentId={incidentId}
						cwd={cwd}
						agent={agent}
						runName={runName}
						briefBy={briefBy}
						chat={chat}
						reportTitle={report?.title}
						reportSummary={report?.summary}
						reportStop={report?.stop}
						reportLasting={report?.lasting}
						loginHint={loginHint}
						endStatus={i === lastEnd ? status : undefined}
						limits={limits}
						summaryAbove={summaryAbove}
						hasSteps={!!steps}
						group={group}
						open={has(steps?.open)}
						flagged={has(steps?.flagged)}
						highlight={
							lit !== null && group?.own.some((s) => s.n === lit) ? lit : null
						}
						ask={
							item.kind === "ask"
								? steps?.asks?.find((a) => a.askId === item.askId)
								: undefined
						}
						onToggle={steps?.onToggle}
						onSeeFlag={steps?.onSeeFlag}
						fileOf={steps?.fileOf}
						onOpenFile={steps?.onOpenFile}
						runId={runId}
						onOpenSubagent={onOpenSubagent}
						onFork={responseEnds.has(item.key) ? onFork : undefined}
					/>
				),
			});
		if (shown && item.kind === "prose" && responseEnds.has(item.key))
			rows.push({
				key: `${item.key}:actions`,
				at,
				node: (
					<li className="-mt-2">
						<ResponseActions
							text={item.text}
							onFork={onFork ? () => onFork(item.key) : undefined}
						/>
					</li>
				),
			});
		const remote = window && at ? window.folded.get(at) : undefined;
		if (remote)
			rows.push({
				key: `${item.key}:remote-fold`,
				at,
				node: <RemoteFoldToggle fold={remote} onOpen={window?.onUnfold} />,
			});
		const full = shown ? window?.fullFor?.(item) : null;
		if (full)
			rows.push({
				key: `${item.key}:full`,
				at,
				node: <ShowFull onShow={full} />,
			});
		if (folds && worked && i === brief)
			rows.push({
				key: `${item.key}:worked`,
				at,
				node: <WorkedToggle worked={worked} />,
			});
		const turnEnd = ends.get(i);
		if (turnEnd)
			rows.push({
				key: `${item.key}:turn-end`,
				at,
				node: (
					<TurnEnd
						summary={turnEnd.summary}
						steps={turnEnd.steps}
						runId={runId}
						turnSeq={turnEnd.seq}
						cwd={cwd}
						onOpenDiff={
							links ? () => links.open({ type: "diff", path: "" }) : undefined
						}
					/>
				),
			});
		if (i === end && report && afterReport)
			rows.push({ key: `${item.key}:after`, at, node: afterReport });
	});
	if (window)
		return (
			<TranscriptLinksContext.Provider value={linkValue}>
				<WindowedTranscript rows={rows} win={window} live={!!live} />
			</TranscriptLinksContext.Provider>
		);
	return (
		<TranscriptLinksContext.Provider value={linkValue}>
			<Conversation className="h-full" data-testid="transcript-scroller">
				<ConversationContent className="px-4 pt-5 pb-2">
					<ol
						className="mx-auto flex w-full max-w-[760px] min-w-0 list-none flex-col gap-3 p-0"
						data-testid="transcript"
						data-copy-markdown
						data-empty={empty ? "" : undefined}
					>
						{rows.map((r) => (
							<Fragment key={r.key}>{r.node}</Fragment>
						))}
					</ol>
				</ConversationContent>
				<ConversationScrollButton />
				<ReleaseOnUnfold open={!!worked?.open || openTurns.size > 0} />
				{/* A jump to a step unfolds its group; the growth must not pull the reader back to the bottom. */}
				<ReleaseOnUnfold open={(steps?.highlight ?? null) !== null} />
			</Conversation>
		</TranscriptLinksContext.Provider>
	);
});

/**
 * Where each finished turn ends and what it did (#1101 cat 9): a turn runs from one of
 * your messages to the next; the live one has no summary until it ends.
 */
/** A finished turn's end: its summary, its steps for the tests it ran, and its span of seqs. */
interface TurnEndData {
	summary: TurnSummary;
	steps: RunStep[];
	seq?: TurnSeq;
}

function turnEnds(
	items: readonly TranscriptItem[],
	groups: ReadonlyMap<string, GroupSteps>,
	live: boolean,
): Map<number, TurnEndData> {
	const out = new Map<number, TurnEndData>();
	const starts = items.flatMap((it, i) =>
		it.kind === "operator" && it.state !== "queued" ? [i] : [],
	);
	for (let n = 0; n < starts.length; n++) {
		const next = starts[n + 1];
		if (next === undefined && live) continue;
		const end = next ?? items.length;
		const steps: RunStep[] = [];
		const pl: string[] = [];
		let toolGroups = 0;
		for (let i = (starts[n] as number) + 1; i < end; i++) {
			const it = items[i];
			if (it?.kind === "tools") {
				toolGroups++;
				steps.push(...(groups.get(it.key)?.own ?? []));
			} else if (it?.kind === "gateway") pl.push(it.name);
		}
		const summary = turnSummary(steps, pl, { groups: toolGroups });
		// It sits after the turn's last line, before a run-end line if there is one.
		let at = end - 1;
		while (at > (starts[n] as number) && items[at]?.kind === "end") at--;
		const first = items[starts[n] as number];
		const start = first?.kind === "operator" ? first.seq : undefined;
		const after = next === undefined ? undefined : items[next];
		const nextSeq = after?.kind === "operator" ? after.seq : undefined;
		if (summary)
			out.set(at, {
				summary,
				steps,
				...(start !== undefined
					? { seq: { start, next: nextSeq ?? null } }
					: {}),
			});
	}
	return out;
}

/** How a page opens a prose link: the thread to resolve against, the address, the action. */
export interface TranscriptLinks {
	threadId: string;
	href: MessageLinks["href"];
	open: MessageLinks["open"];
}

const TranscriptLinksContext = createContext<
	(TranscriptLinks & { liveProse?: string }) | null
>(null);

const NO_TARGETS: ReadonlyMap<string, LinkTarget> = new Map();

/** One agent message; with a page's links, they resolve once it has settled. */
function ProseText({ id, text }: { id: string; text: string }) {
	const links = useContext(TranscriptLinksContext);
	if (!links) return <MessageResponse>{text}</MessageResponse>;
	return <LinkedProse id={id} text={text} links={links} />;
}

/** One `links/resolve` call per message, cached by its key. */
function LinkedProse({
	id,
	text,
	links,
}: {
	id: string;
	text: string;
	links: TranscriptLinks & { liveProse?: string };
}) {
	const candidates = useMemo(() => linkCandidates(text), [text]);
	const resolved = useResolvedLinks(
		links.threadId,
		id,
		candidates,
		links.liveProse !== id,
	);
	const targets = useMemo(
		() =>
			resolved.data
				? targetsByText(candidates, resolved.data.targets)
				: NO_TARGETS,
		[resolved.data, candidates],
	);
	const shown = useMemo(() => linkify(text, targets), [text, targets]);
	const value = useMemo(
		() => ({ targets, href: links.href, open: links.open }),
		[links.href, links.open, targets],
	);
	return <MessageResponse links={value}>{shown}</MessageResponse>;
}

/** Unfolding grows the log; without this the follow-the-tail lock pulls a jump back to the bottom. */
function ReleaseOnUnfold({ open }: { open: boolean }) {
	const { stopScroll } = useStickToBottomContext();
	useEffect(() => {
		if (open) stopScroll();
	}, [open, stopScroll]);
	return null;
}

/** `Worked for 4m 12s, 23 steps`: the steps-unfold row with the sidebar tree's disclosure chevron. */
function WorkedToggle({ worked }: { worked: WorkedFold }) {
	const label = workedLabel(worked.seconds, worked.steps);
	if (!label) return null;
	return (
		<li>
			<button
				type="button"
				onClick={worked.onToggle}
				aria-expanded={worked.open}
				className={TOOL_LINE}
				data-testid="worked-toggle"
			>
				<span className="truncate">{label}</span>
				<ToolLineChevron open={worked.open} />
			</button>
		</li>
	);
}

/** A finished turn's fold: `Worked for 4m 12s`, its work behind the chevron (#1020). */
function TurnToggle({
	fold,
	open,
	onToggle,
}: {
	fold: TurnFold;
	open: boolean;
	onToggle: (key: string) => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={() => onToggle(fold.key)}
				aria-expanded={open}
				className={TOOL_LINE}
				data-testid="turn-fold"
			>
				<span className="truncate">{workedLabel(fold.seconds)}</span>
				<ToolLineChevron open={open} />
			</button>
		</li>
	);
}

/** What a tool group's row knows of the run's steps; every field is stable while its own steps are. */
interface RowSteps {
	hasSteps: boolean;
	group?: GroupSteps;
	open: ReadonlySet<number>;
	flagged: ReadonlySet<number>;
	highlight: number | null;
	onToggle?: (n: number) => void;
	onSeeFlag?: () => void;
	fileOf?: (s: RunStep) => { sha: string } | null;
	onOpenFile?: (s: RunStep) => void;
}

const TranscriptRow = memo(function TranscriptRow({
	item,
	incidentId,
	cwd,
	agent,
	runName,
	briefBy,
	reportTitle,
	reportSummary,
	reportStop,
	reportLasting,
	loginHint,
	limits,
	summaryAbove,
	ask,
	runId,
	chat,
	onOpenSubagent,
	onFork,
	endStatus,
	...steps
}: RowSteps & {
	/** The thread's status when this is its standing end; its word labels a failure. */
	endStatus?: StatusKind;
	item: TranscriptItem;
	incidentId: string | null;
	cwd?: string | null;
	agent: string;
	runName?: string;
	briefBy: string;
	reportTitle?: string;
	reportSummary?: string;
	reportStop?: { title: string; command?: string } | null;
	reportLasting?: string | null;
	loginHint?: string;
	limits?: string | null;
	summaryAbove?: boolean;

	ask?: AskRecord;
	runId?: string;
	chat?: boolean;
	onOpenSubagent?: (sessionId: string) => void;
	/** Set on a response's last row, where the response row offers Fork too. */
	onFork?: (itemKey: string) => void;
}) {
	useRenderProbe("TranscriptRow", { item, ask, ...steps });
	const withMenu = (text: string, row: ReactElement) => (
		<Surface
			id="message"
			ctx={messageCtx(text, onFork ? () => onFork(item.key) : undefined)}
		>
			{row}
		</Surface>
	);
	switch (item.kind) {
		case "prose":
			return withMenu(
				item.text,
				<li className={ENTER} data-testid="transcript-agent">
					{item.text && (
						<div data-testid="transcript-prose" className="leading-[22px]">
							<ProseText id={item.key} text={item.text} />
						</div>
					)}
					{item.draft && (
						<details
							className={cn("text-meta text-text-3", item.text && "mt-2")}
							data-testid="transcript-report-draft"
						>
							<summary className="cursor-pointer hover:text-text-2">
								Report draft as the agent wrote it
							</summary>
							<pre className="m-0 mt-1.5 max-h-80 overflow-auto rounded-control bg-surface-1 px-3 py-2 font-mono text-mono whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]">
								{item.draft}
							</pre>
						</details>
					)}
				</li>,
			);
		case "choice":
			return (
				<li
					className={cn("flex items-start gap-2 text-meta text-text-3", ENTER)}
					data-testid="transcript-choice"
				>
					<CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
					<span className="[overflow-wrap:anywhere]">
						You chose <span className="text-text-1">{item.choice}</span>
						{` · ${item.next}`}
					</span>
				</li>
			);
		case "line":
		case "divider":
			return (
				<li
					className={cn("text-meta text-text-3", ENTER)}
					data-testid={
						item.kind === "line" ? "transcript-line" : "transcript-divider"
					}
					role={
						item.kind === "divider" && item.separator ? "separator" : undefined
					}
				>
					{item.text}
				</li>
			);
		case "level":
			return (
				<li
					className={cn("text-meta text-text-3", ENTER)}
					data-testid={LEVEL_TEST_ID[item.outcome]}
				>
					{item.text}
				</li>
			);
		case "tools":
			return <StepGroup item={item} steps={steps} cwd={cwd} />;
		case "ask": {
			// A waiting ask sits inline where it was asked, mirrored in the dock (#1020).
			if (ask?.state === "waiting" && runId)
				return (
					<li
						className={cn(
							"rounded-surface bg-surface-1 px-3 py-2.5 shadow-[0_0_0_1px_oklch(from_var(--warn)_l_c_h/0.3)]",
							ENTER,
						)}
						data-testid="transcript-ask-card"
					>
						<AskCard ask={ask} runId={runId} agent={agent} cwd={cwd} inline />
					</li>
				);
			// An ask no step carries keeps its own line where it was (#820).
			if (!ask || ask.step !== undefined) return null;
			const end = askEnd(ask);
			return (
				<li
					className={cn(
						"text-meta [overflow-wrap:anywhere]",
						ask.state === "waiting" ? "text-warn" : "text-text-3",
						ENTER,
					)}
					data-testid="transcript-ask"
					data-state={ask.state}
				>
					{askWho(ask, agent)} asked to run {shortPath(askTitle(ask), cwd)}:{" "}
					{end.charAt(0).toLowerCase() + end.slice(1)}
				</li>
			);
		}
		case "artifact":
			return <ArtifactCard artifact={item.artifact} />;
		case "finding":
			return <FindingRow finding={item.finding} />;
		case "gateway":
			return (
				<li
					className={cn(TOOL_LINE, "hover:text-text-2", ENTER)}
					data-testid="transcript-gateway"
					data-node={item.node}
				>
					<span
						className={cn(
							"flex size-3.5 shrink-0 items-center justify-center",
							item.failed ? "text-danger" : "text-text-3",
						)}
					>
						{item.failed ? (
							<X aria-label="Failed" className="size-3.5 stroke-[2]" />
						) : (
							<PlMark />
						)}
					</span>
					<span className="min-w-0 shrink-0 truncate">
						{plLabel(item.name, item.input, item.failed ? "failed" : "done")}
					</span>
					{item.outcome && (
						<span
							className={cn(
								"min-w-0 flex-1 truncate",
								item.failed ? "text-danger" : "text-text-3",
							)}
						>
							{item.outcome}
						</span>
					)}
				</li>
			);
		case "thought":
			return (
				<li
					className="flex h-7 min-w-0 items-center gap-2 text-meta text-text-3"
					data-testid="transcript-thought"
				>
					<Brain aria-hidden className="size-3.5 shrink-0 stroke-[1.75]" />
					Thought for {formatElapsed(item.seconds)}
				</li>
			);
		case "thinking":
			return <ThinkingLine since={item.since} />;
		case "subagent":
			return <SubagentNode agent={item.agent} onOpen={onOpenSubagent} />;
		case "operator": {
			const brief = item.state === "started" && !chat;
			const who = brief ? briefBy : "You";
			const word = brief
				? runName === "Ask"
					? "asked"
					: `brief for ${runName ?? "this run"}`
				: chat && item.state === "started"
					? "sent"
					: deliveryWord(item.state, item.mode, item.waitingOn);
			const steered = !brief && word === STEERED_WORD;
			return withMenu(
				item.text,
				<li
					className={cn(
						"flex max-w-[80%] flex-col gap-0.5 self-end rounded-[10px] bg-surface-2 px-3 py-2",
						ENTER,
					)}
					data-testid="transcript-operator"
					data-state={item.state}
				>
					<span className="text-meta text-text-3">
						{item.restart ? (
							<span data-testid="transcript-restart-label">
								PrismaLens{restartSent(item.restart, Date.now())}
							</span>
						) : (
							<>
								{who}, {formatClock(item.at)}
								{steered ? (
									<Mark
										id="delivery"
										state="steered"
										word="Steered: sent now, stopping the agent's step"
										className="ml-1.5 align-[-2px]"
										testId="transcript-steered"
									/>
								) : (
									<>
										,{" "}
										<span
											className={cn(
												item.state === "not_delivered" && "text-danger",
											)}
											data-testid="transcript-delivery"
										>
											{word}
										</span>
									</>
								)}
							</>
						)}
					</span>
					<OperatorBody
						text={item.text}
						files={item.attachments}
						base={
							incidentId
								? `/api/incidents/${incidentId}/attachments`
								: runId
									? `/api/threads/${runId}/attachments`
									: null
						}
					/>
				</li>,
			);
		}
		case "end": {
			if (item.report && reportTitle !== undefined)
				return (
					<li
						className={cn(
							"flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3.5 py-3",
							ENTER,
						)}
						data-testid="transcript-report"
					>
						<span id="report" className="font-semibold">
							{reportTitle}
						</span>
						{!summaryAbove && (
							<span dir="auto" className="text-text-2">
								{reportSummary}
							</span>
						)}
						{limits && (
							<span className="text-meta text-warn" data-testid="report-limits">
								{limits}
							</span>
						)}
						{/* The result reads here, so a follow-up never needs the overview (#1020). */}
						{reportStop !== undefined && (
							<div className="flex flex-col gap-1" data-testid="report-stop">
								<span className="text-meta text-text-3">Stop the impact</span>
								{reportStop ? (
									<>
										<span dir="auto">{reportStop.title}</span>
										{reportStop.command && (
											<CommandChip command={reportStop.command} />
										)}
									</>
								) : (
									<span className="text-text-2">None suggested.</span>
								)}
							</div>
						)}
						{reportLasting !== undefined && (
							<div className="flex flex-col gap-1" data-testid="report-lasting">
								<span className="text-meta text-text-3">Lasting fix</span>
								{reportLasting ? (
									<span dir="auto">{reportLasting}</span>
								) : (
									<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
										<span className="text-text-2">None named yet.</span>
										{/* The summary's Next already offers it above an incident. */}
										{!summaryAbove && (
											<button
												type="button"
												onClick={() =>
													compose(
														"What lasting fix would stop this from happening again?",
													)
												}
												className="inline-flex min-h-6 items-center text-accent hover:underline"
												data-testid="report-ask-lasting"
											>
												Ask for a lasting fix
											</button>
										)}
									</span>
								)}
							</div>
						)}
						{incidentId && (
							<Link
								to="."
								search={(s) => ({ ...s, panel: "incident" as const })}
								className="inline-flex min-h-6 items-center self-start text-accent underline-offset-[3px] hover:underline"
								data-testid="transcript-report-overview"
							>
								Impact, evidence and changes
							</Link>
						)}
						{item.hint && (
							<span
								className="text-meta text-text-3"
								data-testid="transcript-end-hint"
							>
								{item.hint}
							</span>
						)}
					</li>
				);
			if (item.interrupted)
				return (
					<li
						className={cn(
							"flex flex-col gap-2 rounded-[10px] bg-surface-2 px-3.5 py-3",
							ENTER,
						)}
						data-testid="transcript-interrupted"
					>
						<span className="font-semibold">{item.text}</span>
						<span
							className="text-text-2 [overflow-wrap:anywhere]"
							data-testid="transcript-interrupted-reason"
						>
							{item.detail}
						</span>
					</li>
				);
			const failure =
				item.tone === "failed"
					? failureSentence(agent, item.error, loginHint)
					: null;
			return (
				<li className={cn("space-y-1", ENTER)} data-testid="transcript-end">
					<p className="flex flex-wrap items-baseline gap-x-2 text-text-2">
						{failure ? (
							<span className="[overflow-wrap:anywhere]">
								<Status
									kind={
										endStatus && STOP_KINDS.has(endStatus)
											? endStatus
											: "failed"
									}
									className="text-body"
								/>
								{item.at ? ` at ${formatClock(item.at)}` : ""}: {failure.said}
								{failure.detail && failure.next ? ` ${failure.next}` : ""}
							</span>
						) : (
							<span className="[overflow-wrap:anywhere]">
								{item.text}
								{item.detail ? ` ${item.detail}` : ""}
								{/[.!?]$/.test(item.detail ?? item.text) ? "" : "."}
							</span>
						)}
						{item.hint && (
							<span className="text-text-2" data-testid="transcript-end-hint">
								{item.hint}
							</span>
						)}
					</p>
					{failure?.detail && (
						// The agent's raw words stay one click away, under the sentence that explains them.
						<details className="text-meta text-text-3">
							<summary className="inline-flex min-h-6 cursor-pointer items-center hover:text-text-1">
								The agent's error
							</summary>
							<Block spec={errorDetailBlock} data={{ text: failure.detail }}>
								<p
									className="pr-8 [overflow-wrap:anywhere]"
									data-testid="transcript-end-detail"
								>
									{failure.detail}
								</p>
							</Block>
						</details>
					)}
				</li>
			);
		}
		case "empty":
			return (
				<li
					className="py-6 text-center text-text-2"
					data-testid="transcript-empty"
				>
					{item.text}
				</li>
			);
		case "inbound":
			return <InboundRowView row={item.row} />;
		case "node":
			return (
				<TranscriptNode
					event={item.event}
					runId={runId}
					incidentId={incidentId}
				/>
			);
	}
});

/**
 * A run of tool calls, one card per step. Past {@link FOLD_OVER} the middle
 * folds behind one control; a step opened or highlighted there unfolds it.
 */
/** A group's mark: the ring while one of its calls runs, the tool icon after. */
function GroupIcon({ live }: { live: boolean }) {
	return (
		<span className="flex size-3.5 shrink-0 items-center justify-center text-text-3">
			{live ? (
				<Ring className="size-3.5" />
			) : (
				<Wrench aria-hidden className="size-3.5 stroke-[1.75]" />
			)}
		</span>
	);
}

/** A group's failures as a mark: a cross and a count, the words in the hint. */
function FailMark({ n }: { n: number }) {
	const label = `${n} failed`;
	return (
		<Hint label={label}>
			<span
				role="img"
				aria-label={label}
				className="flex shrink-0 items-center gap-0.5 text-meta text-danger tabular-nums"
				data-testid="tools-failed"
			>
				<X aria-hidden className="size-3 stroke-[2]" />
				{n}
			</span>
		</Hint>
	);
}

function StepGroup({
	item,
	steps,
	cwd,
}: {
	item: Extract<TranscriptItem, { kind: "tools" }>;
	steps: RowSteps;
	cwd?: string | null;
}) {
	useRenderProbe("StepGroup", { item, group: steps.group });
	const [unfolded, setUnfolded] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const own = steps.group?.own ?? [];
	const words = item.summary || `ran ${item.count} tools`;
	const summary = words.charAt(0).toUpperCase() + words.slice(1);
	// The agent's words lead; its steps fold to one line unless one needs you or was linked to.
	const needs =
		own.some((s) => steps.open.has(s.n) || steps.highlight === s.n) ||
		(steps.group?.asks ?? []).some((a) => a?.state === "waiting");
	// Once an ask or a link opened the group, it stays open: answering must not fold it away under the click.
	const held = useRef(false);
	if (needs) held.current = true;
	const open = expanded || held.current;
	if (!steps.hasSteps || own.length === 0)
		return (
			<li
				className="flex min-h-7 items-center gap-2 text-body text-text-2"
				data-testid="transcript-tools"
			>
				<Wrench
					aria-hidden
					className="size-3.5 shrink-0 stroke-[1.75] text-text-3"
				/>
				<span className="truncate">{summary}</span>
			</li>
		);
	const live = own.findLast((s) => s.ok === null && !s.unfinished);
	const denied = (steps.group?.asks ?? []).filter(
		(a) => a?.state === "denied",
	).length;
	const failed = Math.max(0, item.failed - denied);
	const card = (s: RunStep) => (
		<StepCard
			key={s.callId}
			nested
			step={{ ...s, command: shortPath(s.command, cwd) }}
			open={steps.open.has(s.n)}
			onToggle={() => steps.onToggle?.(s.n)}
			highlight={steps.highlight === s.n}
			flagged={steps.flagged.has(s.n)}
			onSeeFlag={steps.onSeeFlag}
			ask={steps.group?.asks[own.indexOf(s)]}
			fileSha={steps.fileOf?.(s)?.sha}
			onOpenFile={steps.onOpenFile ? () => steps.onOpenFile?.(s) : undefined}
		/>
	);
	const groupCtx = (isOpen: boolean) => ({
		commands: own.map((s) => shortPath(s.command, cwd)).join("\n"),
		onToggle: () => {
			held.current = false;
			setExpanded(!isOpen);
		},
		facts: { is: { open: isOpen } },
	});
	if (!open && !needs) {
		// A failure never hides in a fold: it keeps its own line under the header.
		const broken = own.filter(
			(s, i) => s.ok === false && !steps.group?.asks[i],
		);
		return (
			<>
				<Surface id="tool.group" ctx={groupCtx(false)}>
					<li data-testid="transcript-tools" data-folded="">
						<button
							type="button"
							onClick={() => setExpanded(true)}
							className={cn(TOOL_LINE, "max-md:min-h-11")}
							aria-expanded={false}
							data-testid="tools-expand"
						>
							<GroupIcon live={!!live} />
							<span className="truncate">{summary}</span>
							{failed > 0 && <FailMark n={failed} />}
							{denied > 0 && (
								<span className="shrink-0 text-text-3">
									{denied} denied by you
								</span>
							)}
							<span className="flex-1" />
							<ToolLineChevron open={false} />
						</button>
						{live && (
							<p className="truncate pl-[22px] font-mono text-meta text-text-3">
								{shortPath(live.command, cwd)}
							</p>
						)}
					</li>
				</Surface>
				{broken.map(card)}
			</>
		);
	}
	// The middle folds, but a flagged or asked step stays in view (#1101 cat 9).
	const middle = own.length > FOLD_OVER ? own.slice(FOLD_KEEP, -FOLD_KEEP) : [];
	const pinned = (s: RunStep) =>
		steps.flagged.has(s.n) || !!steps.group?.asks[own.indexOf(s)];
	const hidden = new Set(middle.filter((s) => !pinned(s)));
	// Opening or linking a folded step unfolds the whole group, as a jump always did.
	const fold =
		!unfolded &&
		hidden.size > 0 &&
		!middle.some((s) => steps.open.has(s.n) || steps.highlight === s.n);
	const shown = fold ? own.filter((s) => !hidden.has(s)) : own;
	/** The folded run just before a shown step, if any. */
	const runBefore = (s: RunStep): RunStep[] => {
		const run: RunStep[] = [];
		for (
			let i = own.indexOf(s) - 1;
			i >= 0 && hidden.has(own[i] as RunStep);
			i--
		)
			run.unshift(own[i] as RunStep);
		return run;
	};
	return (
		<>
			{/* The header stays while steps show, so opening one never moves the page. */}
			<Surface id="tool.group" ctx={groupCtx(true)}>
				<li>
					<button
						type="button"
						onClick={() => {
							held.current = false;
							setExpanded(false);
						}}
						className={TOOL_LINE}
						aria-expanded
						data-testid="tools-collapse"
					>
						<GroupIcon live={!!live} />
						<span className="truncate">{summary}</span>
						{failed > 0 && <FailMark n={failed} />}
						<span className="flex-1" />
						<ToolLineChevron open />
					</button>
				</li>
			</Surface>
			{shown.map((s) => {
				const run = fold ? runBefore(s) : [];
				return (
					<Fragment key={s.callId}>
						{run.length > 0 && (
							<li>
								<button
									type="button"
									onClick={() => setUnfolded(true)}
									className={cn(TOOL_LINE, "pl-[22px] text-text-3")}
									data-testid="steps-unfold"
								>
									{run.length} more
								</button>
							</li>
						)}
						{card(s)}
					</Fragment>
				);
			})}
		</>
	);
}

/**
 * Evidence or a suspect the agent recorded (#1020): its own words as plain text. Evidence
 * whose quote was not found is marked unverified; a suspect keeps the agent's status word.
 */
function FindingRow({
	finding,
}: {
	finding: Extract<TranscriptItem, { kind: "finding" }>["finding"];
}) {
	const evidence = finding.type === "evidence";
	const Icon = NODE_ICON[evidence ? "evidence" : "suspect"];
	return (
		<li
			className={cn(
				"flex min-w-0 gap-2.5 rounded-surface bg-surface-1 px-3 py-2",
				ENTER,
			)}
			data-testid="transcript-finding"
			data-type={finding.type}
		>
			<Icon className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="flex min-w-0 items-baseline gap-2 text-meta">
					<span className="text-accent">
						{evidence ? "Evidence" : "Suspect"}
					</span>
					{evidence && !finding.anchor && (
						<span className="text-warn" data-testid="finding-unverified">
							Unverified
						</span>
					)}
					<span className="ml-auto min-w-0 truncate text-text-3">
						{evidence ? (
							<span className="font-mono text-mono">
								{finding.path ?? finding.source}
							</span>
						) : (
							<span data-testid="finding-status">
								{statusWord(finding.status)}
							</span>
						)}
					</span>
				</p>
				<p dir="auto" className="[overflow-wrap:anywhere] text-text-1">
					{evidence ? finding.observation : finding.statement}
				</p>
			</div>
		</li>
	);
}

/** The live `Thinking for Ns` line: the one part of the transcript that reads the clock (#874). */
function ThinkingLine({ since }: { since: string }) {
	useRenderProbe("ThinkingLine");
	const now = useSecondClock();
	const s = now === null ? 0 : seconds(since, now);
	const stale = s > STALE_AFTER_S;
	return (
		<li
			className={cn(
				"flex items-center gap-2 tabular-nums",
				stale ? "text-warn" : "text-text-2",
			)}
			data-testid="transcript-thinking"
		>
			<span
				aria-hidden
				className={cn(
					"size-[7px] rounded-full",
					stale ? "bg-warn" : "breathe bg-live",
				)}
				data-testid="transcript-thinking-bar"
			/>
			{stale ? "Quiet" : "Thinking"}
			<span className="text-meta text-text-3">for {formatElapsed(s)}</span>
		</li>
	);
}

/** A sent message: each placed file inline where its chip sat (#1101), the rest below it. */
function OperatorBody({
	text,
	files,
	base,
}: {
	text: string;
	files: AttachmentView[];
	base: string | null;
}) {
	const placed = files
		.filter((f) => f.at !== undefined && f.at <= text.length)
		.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
	const rest = files.filter((f) => !placed.includes(f));
	const pieces: ReactNode[] = [];
	let from = 0;
	for (const f of placed) {
		const at = f.at ?? 0;
		if (at > from) pieces.push(text.slice(from, at));
		pieces.push(<InlineFile key={f.id} file={f} base={base} />);
		from = at;
	}
	if (from < text.length) pieces.push(text.slice(from));
	return (
		<>
			{pieces.length > 0 && (
				<p dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
					{pieces}
				</p>
			)}
			{rest.length > 0 && base && <Attachments base={base} files={rest} />}
		</>
	);
}

/** A file inside a sent message's text: the composer's chip, opening the stored file. */
function InlineFile({
	file: f,
	base,
}: {
	file: AttachmentView;
	base: string | null;
}) {
	const href = base ? `${base}/${f.id}` : undefined;
	const image = f.mimeType.startsWith("image/");
	return (
		<Hint label={f.name} meta={sizeWord(f.size)}>
			<a
				href={href}
				{...(image
					? { target: "_blank", rel: "noreferrer" }
					: { download: f.name })}
				className="mx-px inline-flex h-6 max-w-64 items-center gap-1 rounded-control bg-surface-4 px-1.5 align-middle text-meta text-text-1 hover:bg-surface-3"
				data-testid="transcript-inline-file"
			>
				{image && href ? (
					<img
						src={href}
						alt=""
						className="size-5 rounded-[4px] object-cover"
					/>
				) : (
					<FileText className="size-3.5 shrink-0 text-text-3" aria-hidden />
				)}
				<span className="truncate">{f.name}</span>
			</a>
		</Hint>
	);
}

/** Thumbnails for images, a file chip for text, each opening the stored file. */
function Attachments({
	base,
	files,
}: {
	base: string;
	files: AttachmentView[];
}) {
	return (
		<div
			className="mt-1 flex flex-wrap gap-2"
			data-testid="transcript-attachments"
		>
			{files.map((f) => {
				const href = `${base}/${f.id}`;
				return f.mimeType.startsWith("image/") ? (
					<a key={f.id} href={href} target="_blank" rel="noreferrer">
						<img
							src={href}
							alt={f.name}
							className="h-16 max-w-40 rounded-[var(--radius-control)] object-cover"
						/>
					</a>
				) : (
					<a
						key={f.id}
						href={href}
						download={f.name}
						className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface-3 px-2 text-meta text-text-1 hover:bg-surface-4"
					>
						<FileText className="size-3.5 shrink-0 text-text-3" />
						<span className="truncate">{f.name}</span>
					</a>
				);
			})}
		</div>
	);
}
