// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	capitalTerm,
	type FixItem,
	type PrCheckLog,
	type PrCheckRun,
	type PrHostTerms,
	type PrRerunResult,
	type PrReviewThread,
	prHostTerms,
	type ThreadLink,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Check,
	ChevronLeft,
	CircleDashed,
	CornerDownRight,
	ExternalLink,
	MessageSquare,
	X,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { linkStates } from "@/components/investigation/transcript/link-states";
import { Block } from "@/components/kit/Block";
import { Mark } from "@/components/kit/Mark";
import { Status } from "@/components/kit/Status";
import { Surface } from "@/components/kit/Surface";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { checkExcerptBlock } from "@/components/thread/panel/pr.blocks";
import { Button } from "@/components/ui/button";
import { useThreadContextSettings } from "@/lib/api/hooks/use-app-settings-orpc";
import { useRerunCheck } from "@/lib/api/hooks/use-fix-thread";
import { useThreadLinks } from "@/lib/api/hooks/use-thread-tree-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { compose } from "@/lib/compose";
import { lazyPart } from "@/lib/lazy";
import { cn } from "@/lib/utils";
import { CheckFullLog } from "./CheckFullLog";
import {
	checkIdent,
	checksCount,
	checksTitle,
	fixableRun,
	MERGE_WORD,
	noRunsText,
	otherCount,
	PR_STATUS,
	PR_TONE_WORD,
	type PrAnswers,
	type PrRowActions,
	type PrWatch,
	type PullRequestView,
	prIcon,
	REVIEW_WORD,
	RUN_WORD,
	runGroups,
	sortedRuns,
	watching,
	watchLine,
} from "./PullRequests";
import { annotatedLine, checkFixMessage, reviewFixMessage } from "./pr-fix";
import { ReviewReply } from "./ReviewReply";

// The dialogs and the host's file list load when opened, off the thread page's first paint.
const FixThreadDialog = lazyPart(
	() => import("./FixDialogs").then((m) => m.FixThreadDialog),
	<Loading rows={4} />,
);
const RerunConfirm = lazyPart(
	() => import("./FixDialogs").then((m) => m.RerunConfirm),
	<Loading rows={4} />,
);
const PrHostFiles = lazyPart(
	() => import("./PrFiles").then((m) => m.PrHostFiles),
	<Loading rows={6} />,
);

/** One re-run as the row shows it: the confirm key a Retry resends, and the host's answer. */
export interface RerunState {
	key: string;
	pending: boolean;
	result: PrRerunResult | null;
	failed: boolean;
}

/** What the panel offers a check or review thread: fix threads, re-run, and their state (#1176). */
export interface FixKit {
	/** The newest fix thread on this head that covers an ident; the preview stays the authority. */
	covering: (ident: string) => ThreadLink | undefined;
	onFix?: (items: FixItem[]) => void;
	rerunOff: boolean;
	reruns: Record<string, RerunState>;
	onRerun?: (run: PrCheckRun) => void;
	onRerunRetry?: (run: PrCheckRun) => void;
	waiting: (run: PrCheckRun) => boolean;
	terms: PrHostTerms;
}

const RERUN_WORD: Record<
	Exclude<PrRerunResult, { ok: true }>["failure"],
	string
> = {
	scope: "Token can't re-run jobs",
	locked: "The host refused the re-run",
	rejected: "The host refused the re-run",
	unreachable: "The host didn't answer",
	off: "Re-run is off",
	unsupported: "Can't re-run this one",
	unknown: "Re-run may have started",
};

const ICON_BTN =
	"flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent";
const OUT = "flex flex-col gap-1.5 pb-2 pl-[22px] text-meta text-text-2";

export type PrViewTab = "checks" | "reviews" | "files";

/**
 * The PR view (sheet §4): header, then Checks, Reviews and Files as plain
 * tabs. Lines open in place like tool lines; no nested cards, no badges.
 */
export function PrView({
	pr,
	answers,
	files,
	onBack,
	initialTab,
	...actions
}: {
	pr: PullRequestView;
	answers?: PrAnswers | null;
	/** The Files tab's body: the thread's shared diff. */
	files?: ReactNode;
	onBack?: () => void;
	initialTab?: PrViewTab;
} & PrRowActions) {
	const terms = prHostTerms(pr.host);
	const runs = sortedRuns(pr.checkRuns ?? []);
	const threads = [...(pr.reviewThreads ?? [])].sort(
		(a, b) => Number(a.resolved) - Number(b.resolved),
	);
	const open = threads.filter((t) => !t.resolved).length;
	const [tab, setTab] = useState<PrViewTab>(
		initialTab ??
			(runs.length || pr.reviewThreads === undefined
				? "checks"
				: open
					? "reviews"
					: "checks"),
	);
	const { threadId } = actions;
	const settings = useThreadContextSettings();
	const links = useThreadLinks(threadId ?? null);
	const rerun = useRerunCheck();
	const [fixing, setFixing] = useState<FixItem[] | null>(null);
	const [confirming, setConfirming] = useState<PrCheckRun | null>(null);
	const [reruns, setReruns] = useState<Record<string, RerunState>>({});
	const [othersOpen, setOthersOpen] = useState(false);
	const covering = useMemo(() => {
		const by = new Map<string, ThreadLink>();
		for (const l of links.data?.started ?? []) {
			if (l.via !== "fix" || !l.fix || l.state === "failed") continue;
			if (l.fix.prId !== pr.id || l.fix.headSha !== pr.headSha) continue;
			for (const i of l.fix.items) by.set(i.ident, l);
		}
		return (ident: string) => by.get(ident);
	}, [links.data, pr.id, pr.headSha]);
	const send = (run: PrCheckRun, key: string) => {
		if (!threadId || !run.id) return;
		const at = checkIdent(run);
		setReruns((m) => ({
			...m,
			[at]: { key, pending: true, result: null, failed: false },
		}));
		rerun.mutate(
			{ id: threadId, prId: pr.id, runId: run.id, confirmKey: key },
			{
				onSuccess: (result) =>
					setReruns((m) => ({
						...m,
						[at]: { key, pending: false, result, failed: false },
					})),
				onError: () =>
					setReruns((m) => ({
						...m,
						[at]: { key, pending: false, result: null, failed: true },
					})),
			},
		);
	};
	const kit: FixKit = {
		covering,
		onFix: threadId ? setFixing : undefined,
		rerunOff: settings.data?.rerunChecks !== true,
		reruns,
		onRerun: threadId ? setConfirming : undefined,
		onRerunRetry: (r) => {
			const k = reruns[checkIdent(r)]?.key;
			if (k) send(r, k);
		},
		waiting: (r) =>
			!!r.group &&
			(pr.checkRuns ?? []).some(
				(o) => o.group === r.group && o.state === "pending",
			),
		terms,
	};
	const failingRuns = runs.filter((r) => r.state === "failing");
	const otherRuns = runs.filter((r) => r.state !== "failing");
	const counts = otherCount(pr.checks, runs);
	const fixable = failingRuns.filter(
		(r) => fixableRun(r) && !covering(checkIdent(r)),
	);
	const fixBatch = fixable.slice(0, 5);
	const openThreads = threads.filter((t) => !t.resolved && !covering(t.id));
	const commentBatch = openThreads.slice(0, 5);
	const Icon = prIcon(pr.tone);
	const merge =
		pr.state === "open" ? MERGE_WORD[pr.mergeState ?? "unknown"] : null;
	const review = REVIEW_WORD[pr.review];
	const count = checksCount(pr.checks, terms);
	const failing = runs.filter((r) => r.state === "failing").length;
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="pr-view">
			<header className="flex flex-col gap-1 px-3 pt-2 pb-1">
				<div className="flex min-w-0 items-start gap-1.5">
					{onBack && (
						<Hint label="Back">
							<button
								type="button"
								aria-label="Back"
								className={cn(ICON_BTN, "-ml-1.5")}
								onClick={onBack}
								data-testid="pr-view-back"
							>
								<ChevronLeft className="size-3.5" />
							</button>
						</Hint>
					)}
					<Icon
						aria-hidden
						className={cn(
							// The state's colour is the Status below; the kind glyph stays quiet.
							"mt-1.5 size-3.5 shrink-0 stroke-[1.75] text-text-3",
						)}
					/>
					<h2
						className="line-clamp-2 min-w-0 flex-1 pt-0.5 text-body font-medium text-text-1"
						data-testid="pr-view-title"
					>
						{pr.title ?? pr.repo}
					</h2>
					<Hint label="Open on the host">
						<a
							href={pr.url}
							target="_blank"
							rel="noreferrer"
							aria-label="Open on the host"
							className={ICON_BTN}
						>
							<ExternalLink className="size-3.5" />
						</a>
					</Hint>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<p
						className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-meta text-text-2"
						data-testid="pr-view-meta"
					>
						<span data-testid="pr-tone-word">
							<Status
								kind={PR_STATUS[pr.tone]}
								word={PR_TONE_WORD[pr.tone]}
								fact="pr"
							/>
						</span>
						<span className="text-text-1 tabular-nums">
							{terms.numberPrefix}
							{pr.number}
						</span>
						{count && (
							<>
								<span aria-hidden className="text-text-3">
									·
								</span>
								<Hint label={checksTitle(pr.checks, terms) ?? count}>
									<span className="tabular-nums" data-testid="pr-checks-count">
										{count}
									</span>
								</Hint>
							</>
						)}
						{merge && (
							<>
								<span aria-hidden className="text-text-3">
									·
								</span>
								<span data-testid="pr-merge">{merge[0]}</span>
							</>
						)}
						{pr.conflicts && pr.mergeState !== "conflicts" && (
							<>
								<span aria-hidden className="text-text-3">
									·
								</span>
								<span data-testid="pr-conflicts">Merge conflict</span>
							</>
						)}
						{review && (
							<>
								<span aria-hidden className="text-text-3">
									·
								</span>
								<span data-testid="pr-review">{review}</span>
							</>
						)}
					</p>
					<WatchLine pr={pr} onWatch={actions.onWatch} />
				</div>
				{pr.headRef && (
					<p
						className="min-w-0 truncate font-mono text-meta text-text-3"
						data-testid="pr-branches"
					>
						{pr.headRef}
						{pr.baseRef && (
							<>
								<span className="font-sans"> into </span>
								{pr.baseRef}
							</>
						)}
					</p>
				)}
				{answers && (answers.incidentNumber || answers.cause) && (
					<p
						className="min-w-0 truncate text-meta text-text-2"
						data-testid="pr-answers"
					>
						{answers.incidentNumber
							? `Answers incident #${answers.incidentNumber}`
							: "Answers this thread's report"}
						{answers.cause && (
							<span className="text-text-3">: {answers.cause}</span>
						)}
					</p>
				)}
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
				<Tabs
					label={capitalTerm(terms.changeRequest)}
					value={tab}
					onValueChange={(v) => setTab(v as PrViewTab)}
					items={[
						{
							value: "checks",
							label: capitalTerm(terms.ci),
							count: failing || undefined,
							testId: "pr-tab-checks",
						},
						{
							value: "reviews",
							label: "Reviews",
							count: open || undefined,
							testId: "pr-tab-reviews",
						},
						{ value: "files", label: "Files", testId: "pr-tab-files" },
					]}
				>
					<TabPanel value="checks">
						{failingRuns.length ? (
							<div className="flex flex-col gap-2" data-testid="pr-check-runs">
								<section
									aria-label={`${RUN_WORD.failing} ${failingRuns.length}`}
									data-testid="pr-check-group"
									data-state="failing"
								>
									<div className="flex items-center gap-1.5 px-1 pb-0.5 text-meta text-text-3">
										<span>{RUN_WORD.failing}</span>
										<span className="flex-1 tabular-nums">
											{failingRuns.length}
										</span>
										{kit.onFix && fixBatch.length >= 2 && (
											<Hint
												label={
													fixable.length > fixBatch.length
														? `${fixable.length - fixBatch.length} more stay listed`
														: "One thread fixes all of them"
												}
											>
												<Button
													variant="text"
													size="sm"
													onClick={() =>
														kit.onFix?.(
															fixBatch.map((r) => ({
																kind: "check" as const,
																runId: r.id ?? "",
															})),
														)
													}
													data-testid="pr-fix-batch"
												>
													Fix {fixBatch.length} in one thread
												</Button>
											</Hint>
										)}
									</div>
									<ul className="m-0 flex list-none flex-col p-0">
										{failingRuns.map((r, i) => (
											<CheckLine
												key={`${r.appName ?? ""}:${r.name}:${r.id ?? ""}`}
												pr={pr}
												run={r}
												defaultOpen={i === 0}
												kit={kit}
												{...actions}
											/>
										))}
									</ul>
									{counts.moreFailing > 0 && (
										<Hint label="Only the host lists the rest">
											<p
												className="m-0 px-1 pt-0.5 text-meta text-text-3"
												data-testid="pr-more-failing"
											>
												{counts.moreFailing} more failing
											</p>
										</Hint>
									)}
								</section>
								{counts.others > 0 && (
									<section data-testid="pr-others">
										<button
											type="button"
											className={cn(TOOL_LINE, "px-1 text-meta text-text-2")}
											aria-expanded={othersOpen}
											onClick={() => setOthersOpen(!othersOpen)}
											data-testid="pr-others-line"
										>
											<span className="min-w-0 flex-1 truncate">
												{counts.others} other {terms.checks}
											</span>
											<ToolLineChevron open={othersOpen} />
										</button>
										{othersOpen && (
											<>
												<ul className="m-0 flex list-none flex-col p-0">
													{otherRuns.map((r) => (
														<CheckLine
															key={`${r.appName ?? ""}:${r.name}:${r.id ?? ""}`}
															pr={pr}
															run={r}
															kit={kit}
															{...actions}
														/>
													))}
												</ul>
												{counts.more > 0 && (
													<a
														href={pr.url}
														target="_blank"
														rel="noreferrer"
														className="inline-flex min-h-6 items-center px-1 text-meta text-text-2 hover:text-text-1"
														data-testid="pr-others-more"
													>
														{counts.more} more on the host
													</a>
												)}
											</>
										)}
									</section>
								)}
							</div>
						) : runs.length ? (
							<div className="flex flex-col gap-2" data-testid="pr-check-runs">
								{runGroups(runs).map((g, gi) => (
									<section
										key={g.state}
										aria-label={`${RUN_WORD[g.state]} ${g.runs.length}`}
										data-testid="pr-check-group"
										data-state={g.state}
									>
										<p className="m-0 flex items-baseline gap-1.5 px-1 pb-0.5 text-meta text-text-3">
											<span>{RUN_WORD[g.state]}</span>
											<span className="tabular-nums">{g.runs.length}</span>
										</p>
										<ul className="m-0 flex list-none flex-col p-0">
											{g.runs.map((r, i) => (
												<CheckLine
													key={`${r.appName ?? ""}:${r.name}:${r.id ?? ""}`}
													pr={pr}
													run={r}
													defaultOpen={gi === 0 && i === 0}
													kit={kit}
													{...actions}
												/>
											))}
										</ul>
									</section>
								))}
							</div>
						) : (
							<Empty text={noRunsText(pr.checks, terms)} />
						)}
					</TabPanel>
					<TabPanel value="reviews">
						{kit.onFix && commentBatch.length >= 2 && (
							<div className="flex justify-end px-1 pb-0.5">
								<Hint
									label={
										openThreads.length > commentBatch.length
											? `${openThreads.length - commentBatch.length} more stay listed`
											: "One thread addresses all of them"
									}
								>
									<Button
										variant="text"
										size="sm"
										onClick={() =>
											kit.onFix?.(
												commentBatch.map((t) => ({
													kind: "review" as const,
													reviewThreadId: t.id,
												})),
											)
										}
										data-testid="pr-fix-comments-batch"
									>
										Fix {commentBatch.length} comments in one thread
									</Button>
								</Hint>
							</div>
						)}
						{threads.length ? (
							<ul
								className="m-0 flex list-none flex-col p-0"
								data-testid="pr-review-threads"
							>
								{threads.map((t) => (
									<ReviewLine
										key={t.id}
										pr={pr}
										thread={t}
										kit={kit}
										{...actions}
									/>
								))}
							</ul>
						) : (
							!pr.reviewThreadsNote && <Empty text="No review threads" />
						)}
						{pr.reviewThreadsNote && (
							<p
								className="px-1 pt-1 text-meta text-text-3"
								data-testid="pr-review-note"
							>
								{pr.reviewThreadsNote}
							</p>
						)}
					</TabPanel>
					<TabPanel value="files">
						{threadId ? (
							<PrHostFiles threadId={threadId} prId={pr.id} />
						) : (
							(files ?? <Empty text="No diff here" />)
						)}
					</TabPanel>
				</Tabs>
			</div>
			{fixing && threadId && (
				<FixThreadDialog
					threadId={threadId}
					prId={pr.id}
					items={fixing}
					onClose={() => setFixing(null)}
				/>
			)}
			{confirming && (
				<RerunConfirm
					name={confirming.name}
					sha={confirming.headSha ?? pr.headSha ?? null}
					terms={terms}
					onConfirm={() => {
						send(confirming, crypto.randomUUID());
						setConfirming(null);
					}}
					onClose={() => setConfirming(null)}
				/>
			)}
		</div>
	);
}

/** "Go to thread" with the fix thread's status mark, in place of starting another. */
function GoToThread({ link, testId }: { link: ThreadLink; testId: string }) {
	return (
		<Link
			to="/threads/$id"
			params={{ id: link.id }}
			className="inline-flex min-h-6 items-center gap-1.5 px-2 text-meta whitespace-nowrap text-text-2 hover:text-text-1"
			data-testid={testId}
		>
			<Status
				kind={link.status ?? linkStates.get(link.state).status}
				showWord={false}
				fact={null}
			/>
			Go to thread
		</Link>
	);
}

/** A re-run's answer under its row: words from the closed set, the host's own on hover. */
export function RerunLine({
	run,
	state,
	kit,
}: {
	run: PrCheckRun;
	state: RerunState;
	kit: FixKit;
}) {
	if (state.pending)
		return (
			<span
				className="flex items-center gap-1.5 text-text-3"
				data-testid="rerun-status"
				data-state="sending"
			>
				<Ring className="size-3" />
				Sending the re-run
			</span>
		);
	if (state.failed)
		return (
			<Problem
				text="Re-run didn't send"
				onRetry={() => kit.onRerunRetry?.(run)}
			/>
		);
	const r = state.result;
	if (!r) return null;
	if (r.ok)
		return (
			<span
				className="text-text-2"
				data-testid="rerun-status"
				data-state={r.already ? "already" : "ok"}
			>
				{r.already ? "Re-run already started" : "Re-run started"}
			</span>
		);
	return (
		<span
			className="flex flex-wrap items-center gap-1"
			data-testid="rerun-status"
			data-state={r.failure}
		>
			<Hint label={r.message || RERUN_WORD[r.failure]}>
				<span className="text-text-1">{RERUN_WORD[r.failure]}</span>
			</Hint>
			{r.failure === "unknown" && (
				<>
					{run.url && (
						<a
							href={run.url}
							target="_blank"
							rel="noreferrer"
							className="inline-flex min-h-6 items-center px-2 text-meta text-text-2 hover:text-text-1"
							data-testid="rerun-open-host"
						>
							Open on host
						</a>
					)}
					<Button
						variant="text"
						size="sm"
						onClick={() => kit.onRerun?.(run)}
						data-testid="rerun-again"
					>
						Re-run again
					</Button>
				</>
			)}
		</span>
	);
}

/** Why Re-run is not offered now; false when it is. */
function rerunBlocked(run: PrCheckRun, kit: FixKit): string | false {
	if (kit.waiting(run)) return "Its workflow is still running";
	if (!run.rerunnable) return "Can't re-run this one";
	if (kit.rerunOff) return "Re-run is off";
	return false;
}

function WatchLine({
	pr,
	onWatch,
}: {
	pr: PullRequestView;
	onWatch?: PrRowActions["onWatch"];
}) {
	const w = pr.watch;
	if (!w && (!onWatch || pr.state === "merged" || pr.state === "closed"))
		return null;
	return (
		<span
			className="flex shrink-0 items-center gap-1.5 text-meta text-text-3"
			data-testid="pr-watch"
		>
			<Mark
				id="watch"
				state={w?.state ?? "off"}
				word={w ? watchLine(w) : "Not watched"}
				testId="pr-watch-mark"
			/>
			{onWatch && (
				<Button
					variant="text"
					size="sm"
					onClick={() => onWatch(pr, !(w && watching(w as PrWatch)))}
				>
					{w && watching(w) ? "Stop watching" : "Watch"}
				</Button>
			)}
		</span>
	);
}

const RUN_MARK: Record<PrCheckRun["state"], ReactNode> = {
	failing: <X aria-hidden className="size-3.5 stroke-[2] text-danger" />,
	pending: <Ring className="size-3.5 text-accent" />,
	neutral: <CircleDashed aria-hidden className="size-3.5 text-text-3" />,
	passing: <Check aria-hidden className="size-3.5 text-text-3" />,
};

/** One check as one line; a failing one opens to its step and log tail. */
function CheckLine({
	pr,
	run,
	defaultOpen,
	threadId,
	onOpenFile,
	onDraft = compose,
	own,
	kit,
}: {
	pr: PullRequestView;
	run: PrCheckRun;
	/** The first failing check opens with the view: it is why the user came. */
	defaultOpen?: boolean;
	kit: FixKit;
} & PrRowActions) {
	const failing = run.state === "failing";
	const fixable = fixableRun(run) && !!kit.onFix;
	const blocked = rerunBlocked(run, kit);
	const running = run.state === "pending";
	// A finished check with an id has a log PrismaLens can read in place.
	const hasLog = !!run.id && !running;
	const optional = run.required === false;
	const [open, setOpen] = useState(failing && !optional && !!defaultOpen);
	const [full, setFull] = useState(false);
	const canFull = hasLog && !!threadId;
	const head = (
		<>
			<span
				className={cn(
					"flex size-3.5 shrink-0 items-center justify-center",
					// A check the host merges without never paints the danger colour.
					optional && "[&>svg]:text-text-3",
				)}
			>
				{RUN_MARK[run.state]}
			</span>
			<span className="min-w-0 flex-1 truncate text-text-1">{run.name}</span>
			{run.cancelled && (
				<span
					className="shrink-0 text-meta text-text-3"
					data-testid="pr-check-cancelled"
				>
					Cancelled
				</span>
			)}
			{optional && (
				<span
					className="shrink-0 text-meta text-text-3"
					data-testid="pr-check-optional"
				>
					Optional
				</span>
			)}
		</>
	);
	return (
		<Surface
			id="check.row"
			ctx={{
				url: run.url ?? "",
				toggleLog: () => setOpen(!open),
				showFull: () => {
					setOpen(true);
					setFull(true);
				},
				draftFix: () =>
					onDraft(
						checkFixMessage(
							pr,
							run,
							pr.checkLogs?.find(
								(l) =>
									l.runId === run.id &&
									l.headSha === (run.headSha ?? pr.headSha ?? null),
							),
						),
					),
				fixThread: () => kit.onFix?.([{ kind: "check", runId: run.id ?? "" }]),
				rerun: () => kit.onRerun?.(run),
				facts: {
					is: {
						hasUrl: !!run.url,
						failing,
						running,
						hasLog,
						logOpen: open,
						canFull: canFull && !full,
						fixable,
						own: !!own,
						rerunnable: !!run.rerunnable && !!kit.onRerun,
						rerunWait: kit.waiting(run),
						rerunOff: kit.rerunOff,
					},
				},
			}}
		>
			<li
				data-testid="pr-check-run"
				data-state={run.state}
				data-name={run.name}
				data-ident={checkIdent(run)}
			>
				{hasLog || failing ? (
					<button
						type="button"
						className={cn(TOOL_LINE, "px-1")}
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						data-testid="pr-check-toggle"
					>
						{head}
						<ToolLineChevron open={open} />
					</button>
				) : run.url ? (
					<a
						href={run.url}
						target="_blank"
						rel="noreferrer"
						className={cn(TOOL_LINE, "px-1")}
						aria-label={`${run.name}, ${RUN_WORD[run.state]}. Open its log`}
						data-testid="pr-check-log-link"
					>
						{head}
					</a>
				) : (
					<div className={cn(TOOL_LINE, "px-1")}>{head}</div>
				)}
				{open && (
					<CheckLogTail
						pr={pr}
						run={run}
						threadId={threadId}
						onDraft={onDraft}
						onOpenFile={onOpenFile}
						own={own}
						kit={kit}
						blocked={blocked}
						{...(canFull && !full ? { onFull: () => setFull(true) } : {})}
					/>
				)}
				{open && full && threadId && (
					<div className="pb-2 pl-[1.625rem]">
						<CheckFullLog
							threadId={threadId}
							prId={pr.id}
							run={run}
							kept={
								pr.checkLogs?.find(
									(l) =>
										l.runId === run.id &&
										l.headSha === (run.headSha ?? pr.headSha ?? null),
								)?.lines
							}
							onClose={() => setFull(false)}
						/>
					</div>
				)}
			</li>
		</Surface>
	);
}

/** A failing check's step and last lines, read once and kept per head commit. */
function CheckLogTail({
	pr,
	run,
	threadId,
	onDraft,
	onOpenFile,
	onFull,
	own,
	kit,
	blocked,
}: {
	pr: PullRequestView;
	run: PrCheckRun;
	threadId?: string;
	onDraft: (text: string) => void;
	onOpenFile?: PrRowActions["onOpenFile"];
	/** Shows the whole log under the tail; absent while it shows or when none can be read. */
	onFull?: () => void;
	own?: boolean;
	kit: FixKit;
	blocked: string | false;
}) {
	const covered = kit.covering(checkIdent(run));
	const rerunState = kit.reruns[checkIdent(run)];
	const kept = pr.checkLogs?.find(
		(l) =>
			l.runId === run.id && l.headSha === (run.headSha ?? pr.headSha ?? null),
	);
	const query = useQuery({
		...orpc.threads.prCheckLog.queryOptions({
			input: { id: threadId ?? "", prId: pr.id, runId: run.id ?? "" },
		}),
		enabled: !kept && !!threadId && !!run.id,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const log: PrCheckLog | undefined = kept ?? query.data;
	// The first file:line the log names opens in the diff, as a review thread's line does.
	const at = log ? annotatedLine(log.lines) : null;
	const cut = at?.lastIndexOf(":") ?? -1;
	return (
		<div className={OUT} data-testid="pr-check-tail">
			{query.isLoading && !kept ? (
				<span className="flex items-center gap-1.5 text-text-3">
					<Ring className="size-3" />
					Reading the log
				</span>
			) : !run.id ? (
				<span className="text-text-3">
					No log for this {prHostTerms(pr.host).check}
				</span>
			) : query.error && !log ? (
				<span className="text-text-3">The host refused the log</span>
			) : log?.unavailable ? (
				<span className="text-text-3" data-testid="pr-check-unavailable">
					{log.unavailable}
				</span>
			) : (
				log && (
					<>
						{log.step && (
							<span>
								Failed at <span className="text-text-1">{log.step}</span>
							</span>
						)}
						{/* Lines wrap, so the tail never scrolls sideways; it scrolls down from the keyboard too. */}
						<Block
							spec={checkExcerptBlock}
							data={{ name: run.name, lines: log.lines }}
						>
							<section
								// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling log takes focus so keys can scroll it.
								tabIndex={0}
								aria-label="Log tail"
								className="max-h-64 overflow-y-auto rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<pre
									className="m-0 pr-8 font-mono text-mono break-all whitespace-pre-wrap text-text-2"
									data-testid="pr-check-lines"
								>
									{log.lines.join("\n")}
								</pre>
							</section>
						</Block>
					</>
				)
			)}
			{rerunState && <RerunLine run={run} state={rerunState} kit={kit} />}
			<span className="-ml-2 flex flex-wrap items-center gap-1">
				{fixableRun(run) &&
					kit.onFix &&
					(covered ? (
						<GoToThread link={covered} testId="pr-fix-go-to" />
					) : (
						<Button
							variant="text"
							size="sm"
							onClick={() =>
								kit.onFix?.([{ kind: "check", runId: run.id ?? "" }])
							}
							data-testid="pr-fix-thread"
						>
							Fix in a new thread
						</Button>
					))}
				{run.state === "failing" && own && (
					<Button
						variant="text"
						size="sm"
						onClick={() => onDraft(checkFixMessage(pr, run, log))}
						data-testid="pr-fix-check"
					>
						Ask this thread
					</Button>
				)}
				{at && onOpenFile && (
					<Button
						variant="text"
						size="sm"
						onClick={() =>
							onOpenFile(pr, at.slice(0, cut), Number(at.slice(cut + 1)))
						}
						data-testid="pr-check-where"
					>
						Open {at}
					</Button>
				)}
				{onFull ? (
					<Button
						variant="text"
						size="sm"
						onClick={onFull}
						data-testid="pr-check-full"
					>
						Full log
					</Button>
				) : (
					run.url && (
						<a
							href={run.url}
							target="_blank"
							rel="noreferrer"
							className="inline-flex min-h-6 items-center px-2 text-meta whitespace-nowrap text-text-2 hover:text-text-1"
							data-testid="pr-check-log-link"
						>
							Open on the host
						</a>
					)
				)}
				{run.state === "failing" && kit.onRerun && (
					<Hint
						label={blocked || `Run this ${kit.terms.check} again on the host`}
					>
						<span>
							<Button
								variant="text"
								size="sm"
								disabled={!!blocked || !!rerunState?.pending}
								onClick={() => kit.onRerun?.(run)}
								data-testid="rerun-button"
								data-blocked={blocked || undefined}
							>
								Re-run
							</Button>
						</span>
					</Hint>
				)}
			</span>
		</div>
	);
}

/** One review thread as one line; it opens to its excerpt and the jump to its line. */
function ReviewLine({
	pr,
	thread: given,
	threadId,
	onOpenFile,
	onDraft = compose,
	own,
	kit,
}: {
	pr: PullRequestView;
	thread: PrReviewThread;
	kit: FixKit;
} & PrRowActions) {
	const [open, setOpen] = useState(false);
	// The posted reply shows at once; the stored thread takes over once it has caught up.
	const [posted, setPosted] = useState<PrReviewThread | null>(null);
	const t = posted && posted.replies > given.replies ? posted : given;
	const box = useRef<HTMLTextAreaElement>(null);
	const where = t.line ? `${t.path}:${t.line}` : t.path;
	const state = t.resolved ? "Resolved" : t.outdated ? "Outdated" : "Open";
	const canReply = !t.resolved && !!threadId;
	const covered = kit.covering(t.id);
	const fix = () => kit.onFix?.([{ kind: "review", reviewThreadId: t.id }]);
	const reply = () => {
		setOpen(true);
		requestAnimationFrame(() => box.current?.focus());
	};
	return (
		<Surface
			id="pr.review"
			ctx={{
				url: t.url ?? "",
				reply,
				draftFix: () => onDraft(reviewFixMessage(pr, t)),
				fixThread: fix,
				facts: { is: { hasUrl: !!t.url, open: canReply, own: !!own } },
			}}
		>
			<li data-testid="pr-review-thread" data-resolved={t.resolved}>
				<button
					type="button"
					className={cn(TOOL_LINE, "px-1")}
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					data-testid="pr-review-toggle"
				>
					<MessageSquare
						aria-hidden
						className={cn(
							"size-3.5 shrink-0 stroke-[1.75]",
							t.resolved ? "text-text-3" : "text-warn",
						)}
					/>
					<span className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
						{where}
					</span>
					<span className="shrink-0 text-meta text-text-3">
						{t.author} · {state}
					</span>
					<ToolLineChevron open={open} />
				</button>
				{!open && t.excerpt && (
					// The comment's start, so a row says what was asked without opening it.
					<p
						className="m-0 line-clamp-2 pr-2 pl-[1.625rem] text-meta text-text-2"
						data-testid="pr-review-excerpt"
					>
						{t.excerpt}
					</p>
				)}
				{open && (
					<div className={OUT}>
						<p className="m-0 whitespace-pre-line text-body text-text-2">
							{t.excerpt}
						</p>
						{t.last && (
							<p
								className="m-0 flex min-w-0 items-start gap-1.5 text-body text-text-2"
								data-testid="pr-review-last"
							>
								<CornerDownRight
									aria-label="Latest reply"
									className="mt-1 size-3.5 shrink-0 text-text-3"
								/>
								<span className="shrink-0 text-text-1">{t.last.author}</span>
								<span className="min-w-0 whitespace-pre-line">
									{t.last.excerpt}
								</span>
							</p>
						)}
						{t.replies > 0 && (
							<span className="text-text-3">
								{t.replies} {t.replies === 1 ? "reply" : "replies"}
							</span>
						)}
						{canReply && threadId && (
							<ReviewReply
								ref={box}
								threadId={threadId}
								prId={pr.id}
								thread={t}
								onPosted={setPosted}
							/>
						)}
						<span className="flex flex-wrap items-center gap-1">
							{onOpenFile && (
								<Button
									variant="text"
									size="sm"
									className="-ml-2"
									onClick={() => onOpenFile(pr, t.path, t.line)}
									data-testid="pr-review-where"
								>
									Open {where}
								</Button>
							)}
							{!t.resolved &&
								kit.onFix &&
								(covered ? (
									<GoToThread link={covered} testId="pr-fix-review-go-to" />
								) : (
									<Button
										variant="text"
										size="sm"
										className={onOpenFile ? undefined : "-ml-2"}
										onClick={fix}
										data-testid="pr-fix-review-thread"
									>
										Fix in a new thread
									</Button>
								))}
							{!t.resolved && own && (
								<Button
									variant="text"
									size="sm"
									onClick={() => onDraft(reviewFixMessage(pr, t))}
									data-testid="pr-fix-review"
								>
									Ask this thread
								</Button>
							)}
							{(t.last?.url ?? t.url) && (
								<a
									href={t.last?.url ?? t.url}
									target="_blank"
									rel="noreferrer"
									className="inline-flex min-h-6 items-center px-2 text-meta text-text-2 hover:text-text-1"
									data-testid="pr-review-reply-host"
								>
									Reply on the host
								</a>
							)}
						</span>
					</div>
				)}
			</li>
		</Surface>
	);
}
