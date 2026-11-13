// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	capitalTerm,
	type PrCheckLog,
	type PrCheckRun,
	type PrReviewThread,
	prHostTerms,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import {
	Check,
	ChevronLeft,
	CircleDashed,
	ExternalLink,
	MessageSquare,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	Status,
	TabPanel,
	Tabs,
	TOOL_LINE,
	ToolLineChevron,
} from "@/components/kit";
import { Block } from "@/components/kit/Block";
import { Mark } from "@/components/kit/Mark";
import { Surface } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Empty } from "@/components/shared/State";
import { checkExcerptBlock } from "@/components/thread/panel/pr.blocks";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import { compose } from "@/lib/compose";
import { cn } from "@/lib/utils";
import {
	MERGE_WORD,
	noRunsText,
	PR_STATUS,
	PR_TONE_WORD,
	type PrAnswers,
	type PrRowActions,
	type PrWatch,
	type PullRequestView,
	prIcon,
	prMarkClass,
	REVIEW_WORD,
	RUN_WORD,
	runGroups,
	sortedRuns,
	watching,
	watchLine,
} from "./PullRequests";
import { checkFixMessage, reviewFixMessage } from "./pr-fix";

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
	const Icon = prIcon(pr.tone);
	const merge =
		pr.state === "open" ? MERGE_WORD[pr.mergeState ?? "unknown"] : null;
	const review = REVIEW_WORD[pr.review];
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
							<Status kind={PR_STATUS[pr.tone]} word={PR_TONE_WORD[pr.tone]} />
						</span>
						<span className="text-text-1 tabular-nums">
							{terms.numberPrefix}
							{pr.number}
						</span>
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
						{runs.length ? (
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
						{threads.length ? (
							<ul
								className="m-0 flex list-none flex-col p-0"
								data-testid="pr-review-threads"
							>
								{threads.map((t) => (
									<ReviewLine key={t.id} pr={pr} thread={t} {...actions} />
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
						{files ?? <Empty text="No diff here" />}
					</TabPanel>
				</Tabs>
			</div>
		</div>
	);
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
	onDraft = compose,
}: {
	pr: PullRequestView;
	run: PrCheckRun;
	/** The first failing check opens with the view: it is why the user came. */
	defaultOpen?: boolean;
} & PrRowActions) {
	const failing = run.state === "failing";
	const optional = run.required === false;
	const [open, setOpen] = useState(failing && !optional && !!defaultOpen);
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
				draftFix: () => onDraft(checkFixMessage(pr, run)),
				facts: { is: { hasUrl: !!run.url, failing, logOpen: open } },
			}}
		>
			<li data-testid="pr-check-run" data-state={run.state}>
				{failing ? (
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
				{failing && open && (
					<CheckLogTail
						pr={pr}
						run={run}
						threadId={threadId}
						onDraft={onDraft}
					/>
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
}: {
	pr: PullRequestView;
	run: PrCheckRun;
	threadId?: string;
	onDraft: (text: string) => void;
}) {
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
			<span className="flex items-center gap-1">
				<Button
					variant="text"
					size="sm"
					className="-ml-2"
					onClick={() => onDraft(checkFixMessage(pr, run, log))}
					data-testid="pr-fix-check"
				>
					Ask the agent to fix
				</Button>
				{run.url && (
					<a
						href={run.url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex min-h-6 items-center px-2 text-meta text-text-2 hover:text-text-1"
						data-testid="pr-check-log-link"
					>
						Open log
					</a>
				)}
			</span>
		</div>
	);
}

/** One review thread as one line; it opens to its excerpt and the jump to its line. */
function ReviewLine({
	pr,
	thread: t,
	onOpenFile,
	onDraft = compose,
}: {
	pr: PullRequestView;
	thread: PrReviewThread;
} & PrRowActions) {
	const [open, setOpen] = useState(false);
	const where = t.line ? `${t.path}:${t.line}` : t.path;
	const state = t.resolved ? "Resolved" : t.outdated ? "Outdated" : "Open";
	return (
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
			{open && (
				<div className={OUT}>
					<p className="m-0 whitespace-pre-line text-body text-text-2">
						{t.excerpt}
					</p>
					{t.replies > 0 && (
						<span className="text-text-3">
							{t.replies} {t.replies === 1 ? "reply" : "replies"}
						</span>
					)}
					<span className="flex items-center gap-1">
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
						{!t.resolved && (
							<Button
								variant="text"
								size="sm"
								className={onOpenFile ? undefined : "-ml-2"}
								onClick={() => onDraft(reviewFixMessage(pr, t))}
								data-testid="pr-fix-review"
							>
								Ask the agent to fix
							</Button>
						)}
					</span>
				</div>
			)}
		</li>
	);
}
