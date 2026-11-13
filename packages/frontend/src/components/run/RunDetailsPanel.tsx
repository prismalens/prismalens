// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspace } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	Bot,
	Camera,
	CircleCheck,
	GitBranch,
	Plug,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Block } from "@/components/kit/Block";
import { evidenceBlock } from "@/components/run/report.blocks";
import { Loading } from "@/components/shared/State";
import { type PanelId, panelTabs } from "@/components/thread/panel/panel-model";
import {
	PanelStack,
	ThreadSidePanel,
} from "@/components/thread/panel/ThreadSidePanel";
import { CommandChip } from "@/components/ui/command-chip";
import { citationText, type FileAt } from "@/lib/evidence-files";
import { lazyPart } from "@/lib/lazy";
import type { RunLink } from "@/lib/run-links";
import type { PanelTab, TouchedFile } from "@/lib/run-panel";
import { cn } from "@/lib/utils";
import {
	type ToolsStatus,
	type TurnTools,
	toolsWord,
	turnLine,
} from "./RunTools";
import {
	type DetailLink,
	type DetailRow,
	type DetailSection,
	filterSteps,
	type StepFilter,
} from "./run-details";
import type { RunStep } from "./run-steps";

// The diff and file viewers load when a tab shows them, off the thread page's first paint (#1101 category 12).
const ChangesTab = lazyPart(
	() => import("./ChangesTab").then((m) => m.ChangesTab),
	<Loading />,
);
const BrowserTab = lazyPart(
	() => import("./BrowserTab").then((m) => m.BrowserTab),
	<Loading />,
);
const RunFileTree = lazyPart(
	() => import("./RunFileTree").then((m) => m.RunFileTree),
	<Loading />,
);
const EvidenceFileView = lazyPart(
	() => import("./EvidenceFileView").then((m) => m.EvidenceFileView),
	<Loading />,
);

export type DetailsTab = PanelTab;

/** Opens a cited file; `origin` is the id of the control that opened it, which gets focus back. */
export type OpenFile = (f: FileAt, origin: string) => void;

/** What the Files tab needs to open a file the run read, and the one open now. */
export interface EvidenceFiles {
	runId: string;
	workspace: RunWorkspace | null | undefined;
	/** Files the run's steps named or the report cited, for the tree. */
	touched: TouchedFile[];
	/** Pages the run's alerts and report link, for the Browser tab. */
	links: RunLink[];
	viewing: FileAt | null;
	onOpen: OpenFile;
	onClose: () => void;
	backLabel: string;
	reads: number[];
	codeHost: string | null;
	/** The file a Steps row opens; null when the step names none in the clone. */
	stepFile: (s: RunStep) => FileAt | null;
	onOpenHypotheses: (origin: string) => void;
}

const TONE = {
	ok: "text-ok",
	live: "text-live",
	warn: "text-warn",
	danger: "text-danger",
} as const;

const FILTERS: { id: StepFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "command", label: "Commands" },
	{ id: "file", label: "Files" },
	{ id: "failed", label: "Failed" },
];

/** Which tab an incident route's `?panel=` value shows (#1024); old addresses keep working. */
export function panelIdOf(tab: DetailsTab): PanelId {
	switch (tab) {
		case "incident":
		case "summary":
		case "context":
			return "kind";
		case "steps":
			return "thread";
		case "files":
		case "changes":
			return "changes";
		case "browser":
			return "browser";
	}
}

/**
 * An incident thread's right panel (#1024): the one panel's Incident, Thread and
 * Changes tabs, plus Browser on demand. Incident holds what Summary and Context
 * held; Thread holds Steps; Changes holds files and the diff. Esc closes it.
 */
export function RunDetailsPanel({
	tab,
	onTab,
	onClose,
	incidentId,
	summary,
	evidence,
	context,
	flaggedCount,
	steps,
	onJump,
	files,
	summaryTop,
	contextTop,
	incident,
	subagent,
	thread,
	browser,
	changesTop,
}: {
	/** Above the files and diff: the run's kept workspaces (#1024 moved them here from Summary). */
	changesTop?: ReactNode;
	/** One sub-agent's view, shown in place of the tabs (#1025). */
	subagent?: ReactNode;
	/** An incident thread's impact, fixes, finding and changes, beside the transcript (#1020). */
	incident?: ReactNode;
	/** Above the Context sections: the runbooks the run found (#848). */
	contextTop?: ReactNode;
	/** Above the Summary sections: the run's five steps and its tools (#848). */
	summaryTop?: ReactNode;
	title: string;
	tab: DetailsTab;
	onTab: (tab: DetailsTab) => void;
	onClose: () => void;
	incidentId: string;
	summary: DetailSection[];
	evidence: DetailSection[];
	context: DetailSection[];
	flaggedCount: number;
	steps: RunStep[];
	onJump: (n: number) => void;
	files: EvidenceFiles;
	/** The Thread tab, given the Steps section to place (components/thread/panel/ThreadTab). */
	thread?: (steps: ReactNode) => ReactNode;
	/** A page was opened in the desktop app's view: Browser shows. */
	browser?: boolean;
}) {
	const current = panelIdOf(tab);
	const tabs = panelTabs({
		kind: "incident",
		thread: true,
		changes: true,
		// The run page keeps Browser: its address bar (desktop) and the run's links (browser) live there.
		browser: true,
	}).map((t) =>
		t.id === "kind" && flaggedCount > 0 ? { ...t, flagged: flaggedCount } : t,
	);
	const pick = (id: PanelId) =>
		onTab(
			id === "kind"
				? incident
					? "incident"
					: "summary"
				: id === "thread"
					? "steps"
					: id === "changes"
						? tab === "files"
							? "files"
							: "changes"
						: "browser",
		);
	const filesShown = tab === "files";
	const stepList = steps.length ? (
		<StepsList steps={steps} files={files} onJump={onJump} />
	) : undefined;
	const content =
		current === "kind" ? (
			<PanelStack>
				{incident && <div data-testid="run-details-incident">{incident}</div>}
				<div data-testid="run-details-summary" className="flex flex-col gap-3">
					{summaryTop}
					<Sections
						sections={[...summary, ...evidence]}
						incidentId={incidentId}
						onJump={onJump}
						onOpenFile={files.onOpen}
						onOpenHypotheses={files.onOpenHypotheses}
					/>
				</div>
				<div data-testid="run-details-context" className="flex flex-col gap-3">
					{contextTop}
					<Sections
						sections={context}
						incidentId={incidentId}
						onJump={onJump}
						onOpenFile={files.onOpen}
						onOpenHypotheses={files.onOpenHypotheses}
					/>
				</div>
			</PanelStack>
		) : current === "thread" ? (
			(thread?.(stepList) ?? <PanelStack>{stepList}</PanelStack>)
		) : current === "changes" ? (
			<div className="flex min-h-0 flex-1 flex-col">
				{changesTop && <div className="shrink-0 px-3 pt-2.5">{changesTop}</div>}
				<fieldset
					aria-label="Show"
					className="m-0 flex min-w-0 shrink-0 gap-1 border-0 px-3 pt-2.5 pb-0"
				>
					<ChangesToggle
						on={filesShown}
						onClick={() => onTab("files")}
						testId="run-details-tab-files"
					>
						Files {files.touched.length}
					</ChangesToggle>
					<ChangesToggle
						on={!filesShown}
						onClick={() => onTab("changes")}
						testId="run-details-tab-changes"
					>
						Diff
					</ChangesToggle>
				</fieldset>
				{filesShown ? (
					<div
						className="flex min-h-0 flex-1 flex-col"
						data-testid="run-details-files"
					>
						<FilesPane files={files} onJump={onJump} />
					</div>
				) : (
					<div
						className="flex min-h-0 flex-1 flex-col"
						data-testid="run-details-changes"
					>
						<ChangesTab
							key={files.runId}
							runId={files.runId}
							workspace={files.workspace}
						/>
					</div>
				)}
			</div>
		) : (
			<div
				className="flex min-h-0 flex-1 flex-col"
				data-testid="run-details-browser"
			>
				<BrowserTab links={files.links} />
			</div>
		);
	return (
		<div
			id="run-details"
			className="flex h-full min-h-0 flex-col"
			data-testid="run-details"
		>
			<ThreadSidePanel
				tabs={tabs}
				tab={current}
				onTab={pick}
				onClose={onClose}
				content={content}
				override={subagent}
				overrideLabel="Sub-agent"
				closeTestId="run-details-close"
			/>
		</div>
	);
}

function ChangesToggle({
	on,
	onClick,
	testId,
	children,
}: {
	on: boolean;
	onClick: () => void;
	testId: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"h-6 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
				on ? "bg-surface-3 text-text-1" : "text-text-2 hover:text-text-1",
			)}
			data-testid={testId}
		>
			{children}
		</button>
	);
}

/** The run's steps, filtered and timestamped; a failed one is a click from its step. */
export function StepsList({
	steps,
	files,
	onJump,
}: {
	steps: RunStep[];
	files: Pick<EvidenceFiles, "stepFile" | "onOpen">;
	onJump: (n: number) => void;
}) {
	const [filter, setFilter] = useState<StepFilter>("all");
	const shown = filterSteps(steps, filter);
	return (
		<div className="flex flex-col" data-testid="run-details-steps">
			<fieldset
				aria-label="Show"
				className="m-0 flex min-w-0 shrink-0 gap-1 border-0 px-1 pt-0.5 pb-0"
			>
				{FILTERS.map((f) => (
					<ChangesToggle
						key={f.id}
						on={f.id === filter}
						onClick={() => setFilter(f.id)}
						testId={`steps-filter-${f.id}`}
					>
						{f.label}
					</ChangesToggle>
				))}
			</fieldset>
			<ol className="m-0 list-none px-1 pt-2">
				{shown.length === 0 && (
					<li className="px-2 py-1.5 text-text-2">No steps match.</li>
				)}
				{shown.map((s) => {
					const file = files.stepFile(s);
					const id = `steps-row-${s.n}`;
					return (
						<li key={s.callId}>
							<button
								type="button"
								id={id}
								// A step that read a file in the clone opens it; any other jumps to the step.
								onClick={() => (file ? files.onOpen(file, id) : onJump(s.n))}
								className="flex w-full items-baseline gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3"
								data-testid="steps-row"
								data-step={s.n}
							>
								<span className="w-11 shrink-0 text-meta text-text-3">
									Step {s.n}
								</span>
								<span className="flex min-w-0 flex-1 flex-col">
									<span
										className={cn(
											"truncate",
											s.ok === false ? "text-danger" : "text-text-1",
										)}
									>
										{s.title}
									</span>
									{s.title !== s.command && (
										<span className="truncate font-mono text-mono text-text-3">
											{s.command}
										</span>
									)}
								</span>
								<span className="shrink-0 text-meta text-text-3 tabular-nums">
									{clock(s.at)}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</div>
	);
}

const clockFmt = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});
const clock = (at: string) => clockFmt.format(new Date(at));

function Sections({
	sections,
	incidentId,
	onJump,
	onOpenFile,
	onOpenHypotheses,
}: {
	sections: DetailSection[];
	incidentId: string;
	onJump: (n: number) => void;
	onOpenFile: OpenFile;
	onOpenHypotheses: (origin: string) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			{sections.map((sec) => (
				<section key={sec.title} className="flex flex-col gap-1.5">
					<h3 className="text-meta font-semibold text-text-2">{sec.title}</h3>
					{sec.rows.map((row, i) => (
						<Row
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional within a section and never reorder.
							key={i}
							row={row}
							incidentId={incidentId}
							onJump={onJump}
							onOpenFile={onOpenFile}
							onOpenHypotheses={onOpenHypotheses}
							origin={`cite-${sec.title}-${i}`.replace(/\W+/g, "-")}
						/>
					))}
				</section>
			))}
		</div>
	);
}

function Row({
	row,
	incidentId,
	onJump,
	onOpenFile,
	onOpenHypotheses,
	origin,
}: {
	row: DetailRow;
	incidentId: string;
	onJump: (n: number) => void;
	onOpenFile: OpenFile;
	onOpenHypotheses: (origin: string) => void;
	origin: string;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2",
				row.box === "danger" &&
					"rounded-surface bg-[oklch(from_var(--danger)_l_c_h/0.14)] px-2.5 py-2",
			)}
			data-testid="detail-row"
		>
			{row.label && (
				<span className="w-[88px] shrink-0 text-meta leading-5 text-text-3">
					{row.label}
				</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				{row.mono ? (
					<Block spec={evidenceBlock} data={{ text: row.text }}>
						<span
							dir="auto"
							className={cn(
								"block pr-8 font-mono text-mono leading-5 [overflow-wrap:anywhere]",
								row.tone ? TONE[row.tone] : "text-text-1",
								row.strong && "font-semibold",
							)}
						>
							{row.text}
						</span>
					</Block>
				) : (
					<span
						dir="auto"
						className={cn(
							"[overflow-wrap:anywhere]",
							row.tone ? TONE[row.tone] : "text-text-1",
							row.strong && "font-semibold",
						)}
					>
						{row.text}
					</span>
				)}
				{row.flag && (
					<span
						className="inline-flex items-center gap-1 self-start rounded-full bg-warn/12 px-1.5 text-meta font-medium text-warn"
						data-testid="detail-flag"
					>
						<TriangleAlert className="size-3" aria-hidden />
						{row.flag}
					</span>
				)}
				{row.sub && (
					<span
						dir="auto"
						className={cn(
							"text-meta [overflow-wrap:anywhere]",
							row.box ? "text-text-1" : "text-text-3",
						)}
					>
						{row.sub}
					</span>
				)}
				{row.file && (
					<button
						type="button"
						id={origin}
						onClick={() => row.file && onOpenFile(row.file, origin)}
						className="self-start rounded-control text-left font-mono text-mono text-accent underline underline-offset-[3px] decoration-[oklch(from_var(--accent)_l_c_h/0.4)] hover:decoration-current [overflow-wrap:anywhere]"
						data-testid="detail-file"
					>
						{citationText(row.file)}
					</button>
				)}
				{row.link?.kind === "hypotheses" ? (
					<button
						type="button"
						id={origin}
						onClick={() => onOpenHypotheses(origin)}
						className="self-start rounded-control text-meta text-accent underline underline-offset-[3px] decoration-[oklch(from_var(--accent)_l_c_h/0.4)] hover:decoration-current"
						data-testid="detail-hypotheses"
					>
						{row.action ?? "Open"}
					</button>
				) : (
					row.link && (
						<LeaveLink link={row.link} incidentId={incidentId}>
							{row.action ?? "Open"}
						</LeaveLink>
					)
				)}
			</span>
			{row.step !== undefined && (
				<button
					type="button"
					onClick={() => onJump(row.step as number)}
					aria-label={`Show step ${row.step} in the transcript`}
					className="h-[22px] shrink-0 rounded-full bg-surface-3 px-2 text-meta text-accent transition-colors duration-(--dur-instant) hover:bg-surface-4"
					data-testid="detail-step"
				>
					Step {row.step}
				</button>
			)}
			{row.step === undefined && row.from && (
				<span
					className="shrink-0 text-meta text-text-3"
					data-testid="detail-from"
				>
					{row.from}
				</span>
			)}
		</div>
	);
}

/**
 * A link that leaves the page: underlined accent text, never a chip, so it
 * reads apart from a step jump's pill, which stays on the page (#811).
 */
function LeaveLink({
	link,
	incidentId,
	children,
}: {
	link: Exclude<DetailLink, { kind: "hypotheses" }>;
	incidentId: string;
	children: ReactNode;
}) {
	const cls =
		"inline-flex min-h-6 items-center self-start text-meta text-accent underline underline-offset-[3px] decoration-[oklch(from_var(--accent)_l_c_h/0.4)] hover:decoration-current";
	if (link.kind === "overview")
		return (
			<Link
				to="/incidents/$id"
				params={{ id: incidentId }}
				hash="stop-the-impact"
				className={cls}
				data-testid="detail-link"
			>
				{children}
			</Link>
		);
	if (link.kind === "run")
		return (
			<Link
				to="/incidents/$id/conversation"
				params={{ id: incidentId }}
				search={{ investigation: link.id }}
				className={cls}
				data-testid="detail-link"
			>
				{children}
			</Link>
		);
	return (
		<Link
			to="/settings"
			search={{ tab: link.section }}
			className={cls}
			data-testid="detail-link"
		>
			{children}
		</Link>
	);
}

const STEP_TONE = {
	ok: "bg-ok/15 text-ok",
	warn: "bg-warn/15 text-warn",
	neutral: "bg-surface-3 text-text-2",
} as const;

export interface RunOverviewStep {
	name: "Snapshot" | "Code" | "Agent" | "Tools" | "Model";
	text: string;
	tone: keyof typeof STEP_TONE;
}

const STEP_ICON = {
	Snapshot: Camera,
	Code: GitBranch,
	Agent: Bot,
	Tools: Plug,
	Model: CircleCheck,
} as const;

/** The five steps' short states, from the run's tools status (#848). */
export function overviewSteps(o: {
	snapshot: string;
	code: string;
	agent: string;
	status: ToolsStatus;
}): RunOverviewStep[] {
	const s = o.status.state;
	const tools: Pick<RunOverviewStep, "text" | "tone"> =
		s === "reached" || s === "connected"
			? { text: "Connected", tone: "ok" }
			: s === "not-reached"
				? { text: "Not connected", tone: "warn" }
				: {
						text:
							s === "loading"
								? "Loading"
								: s === "error"
									? "Did not load"
									: s === "waiting"
										? "Waiting"
										: "Not recorded",
						tone: "neutral",
					};
	const model: Pick<RunOverviewStep, "text" | "tone"> =
		s === "reached"
			? { text: "Used a tool", tone: "ok" }
			: s === "connected"
				? { text: "Not called yet", tone: "neutral" }
				: s === "not-reached"
					? { text: "Did not get them", tone: "warn" }
					: tools;
	return [
		{ name: "Snapshot", text: o.snapshot, tone: "neutral" },
		{ name: "Code", text: o.code, tone: "neutral" },
		{ name: "Agent", text: o.agent, tone: "neutral" },
		{ name: "Tools", ...tools },
		{ name: "Model", ...model },
	];
}

/**
 * The Summary's head (#848): the five-step strip, then whether PrismaLens's
 * tools reached the model, per turn a count per tool and the first time.
 * Every later call time stays in the logs.
 */
export function RunOverview({
	steps,
	status,
	turns,
	hint,
}: {
	steps: RunOverviewStep[];
	status: ToolsStatus;
	turns: TurnTools[];
	/** The agent's own line when the tools did not reach it, and the folder to trust. */
	hint?: { text: string; folder: string | null } | null;
}) {
	return (
		<div className="mb-4 flex flex-col gap-4" data-testid="run-overview">
			<ol className="grid grid-cols-5 gap-1" aria-label="Run steps">
				{steps.map((st) => {
					const Icon = STEP_ICON[st.name];
					return (
						<li
							key={st.name}
							className="flex min-w-0 flex-col items-start gap-1"
							data-testid={`run-step-${st.name.toLowerCase()}`}
						>
							<span
								className={cn(
									"grid size-6 place-items-center rounded-full",
									STEP_TONE[st.tone],
								)}
								aria-hidden
							>
								<Icon className="size-3.5" />
							</span>
							<span className="text-meta font-semibold">{st.name}</span>
							<span className="line-clamp-2 text-meta text-text-2 [overflow-wrap:anywhere]">
								{st.text}
							</span>
						</li>
					);
				})}
			</ol>
			<RunToolsSection status={status} turns={turns} hint={hint} />
		</div>
	);
}

/** Whether PrismaLens's tools reached the agent, per turn, and what to do when they did not. */
export function RunToolsSection({
	status,
	turns,
	hint,
}: {
	status: ToolsStatus;
	turns: TurnTools[];
	/** The agent's own line when the tools did not reach it, and the folder to trust. */
	hint?: { text: string; folder: string | null } | null;
}) {
	return (
		<section className="flex flex-col gap-1.5" aria-label="PrismaLens tools">
			<h3 className="text-meta font-semibold text-text-2">PrismaLens tools</h3>
			<p
				className={cn(
					status.state === "not-reached" ? "text-warn" : "text-text-1",
					status.state === "loading" && "text-text-3",
				)}
				role="status"
				data-testid="run-tools-status"
			>
				{toolsWord(status)}
			</p>
			{status.state === "not-reached" && hint && (
				<div className="flex flex-col gap-1.5" data-testid="run-tools-hint">
					<p className="text-meta text-text-2">{hint.text}</p>
					{hint.folder && <CommandChip command={hint.folder} path />}
				</div>
			)}
			{turns.map((t) => (
				<div
					key={t.turn}
					className="flex flex-col gap-1"
					data-testid={`run-tools-turn-${t.turn}`}
				>
					<span className="text-meta font-medium">
						{t.turn === "first" ? "First turn" : "Follow-up"}
					</span>
					<span className="text-meta text-text-2 tabular-nums">
						{turnLine(t)}
					</span>
					{t.calls.length > 0 && (
						<span className="flex flex-wrap gap-1">
							{t.calls.map((c) => (
								<span
									key={c.name}
									className="inline-flex h-[22px] items-center gap-1 rounded-control bg-surface-3 px-2 font-mono text-mono"
								>
									{c.name}
									{c.count > 1 && (
										<span className="text-text-2">×{c.count}</span>
									)}
								</span>
							))}
						</span>
					)}
				</div>
			))}
		</section>
	);
}

/**
 * The Files tab (#973): the tree beside the open file when the panel is wide
 * enough, else the tree, and the file in its place with Back.
 */
export function FilesPane({
	files,
	onJump,
}: {
	files: EvidenceFiles;
	onJump: (n: number) => void;
}) {
	const [mode, setMode] = useState<"touched" | "all">("touched");
	const { viewing, workspace } = files;
	return (
		<div className="flex min-h-0 flex-1 @container">
			<div
				id="run-files-tree"
				tabIndex={-1}
				className={cn(
					"min-h-0 flex-col outline-none @2xl:flex @2xl:w-60 @2xl:shrink-0 @2xl:shadow-[1px_0_0_var(--hairline)]",
					viewing ? "hidden" : "flex flex-1",
				)}
			>
				<fieldset
					aria-label="Show"
					className="m-0 flex shrink-0 gap-1 border-0 px-3 pt-2.5 pb-1.5"
				>
					{(["touched", "all"] as const).map((m) => (
						<button
							key={m}
							type="button"
							aria-pressed={mode === m}
							onClick={() => setMode(m)}
							className={cn(
								"h-6 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
								mode === m
									? "bg-surface-3 text-text-1"
									: "text-text-2 hover:text-text-1",
							)}
							data-testid={`files-mode-${m}`}
						>
							{m === "touched" ? "Touched" : "All files"}
						</button>
					))}
				</fieldset>
				{!workspace || workspace.repos.length === 0 ? (
					<p className="px-3 text-text-2">This run read no repository.</p>
				) : mode === "touched" && files.touched.length === 0 ? (
					<p className="px-3 text-text-2" data-testid="files-none">
						This run read no files. All files shows the code it was given.
					</p>
				) : (
					<RunFileTree
						key={mode}
						mode={mode}
						runId={files.runId}
						workspace={workspace}
						touched={files.touched}
						selected={viewing}
						onPick={(f) => files.onOpen(f, "run-files-tree")}
					/>
				)}
			</div>
			{viewing ? (
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<EvidenceFileView
						key={`${viewing.sha}:${viewing.path}`}
						runId={files.runId}
						file={viewing}
						onBack={files.onClose}
						backLabel={files.backLabel}
						reads={files.reads}
						onJump={onJump}
						codeHost={files.codeHost}
					/>
				</div>
			) : (
				<p className="hidden flex-1 px-4 pt-4 text-text-2 @2xl:block">
					Pick a file to read it at the commit this run recorded.
				</p>
			)}
		</div>
	);
}
