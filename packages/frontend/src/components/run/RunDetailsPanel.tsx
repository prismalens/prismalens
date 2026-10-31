// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Link } from "@tanstack/react-router";
import {
	Bot,
	Camera,
	CircleCheck,
	GitBranch,
	Plug,
	TriangleAlert,
	X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommandChip } from "@/components/ui/command-chip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { citationText, type FileAt } from "@/lib/evidence-files";
import { cn } from "@/lib/utils";
import { EvidenceFileView } from "./EvidenceFileView";
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

export type DetailsTab = "summary" | "evidence" | "context" | "steps";

/** Opens a cited file; `origin` is the id of the control that opened it, which gets focus back. */
export type OpenFile = (f: FileAt, origin: string) => void;

/** What the Evidence tab needs to open a file the run read, and the one open now. */
export interface EvidenceFiles {
	runId: string;
	viewing: FileAt | null;
	onOpen: OpenFile;
	onClose: () => void;
	backLabel: string;
	phone: boolean;
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

/**
 * The Run details panel (#811): 380 px beside the conversation, never over
 * it; the title row lines up with the header and the tab row with the strip.
 * Esc closes it and the page returns focus to the toggle.
 */
export function RunDetailsPanel({
	title,
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
}: {
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
}) {
	const [filter, setFilter] = useState<StepFilter>("all");
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || e.defaultPrevented) return;
		e.stopPropagation();
		onClose();
	};
	const shown = filterSteps(steps, filter);
	const tabs: {
		id: DetailsTab;
		label: string;
		aside?: ReactNode;
		aria: string;
	}[] = [
		{ id: "summary", label: "Summary", aria: "Summary" },
		{ id: "evidence", label: "Evidence", aria: "Evidence" },
		{
			id: "context",
			label: "Context",
			aria:
				flaggedCount > 0
					? `Context, ${flaggedCount} flagged ${flaggedCount === 1 ? "item" : "items"}`
					: "Context",
			aside:
				flaggedCount > 0 ? (
					<span
						aria-hidden
						className="ml-1.5 inline-block size-1.5 rounded-full bg-danger"
					/>
				) : null,
		},
		{
			id: "steps",
			label: "Steps",
			aria: `Steps, ${steps.length}`,
			aside: (
				<span aria-hidden className="ml-1.5 text-text-3 tabular-nums">
					{steps.length}
				</span>
			),
		},
	];
	const aside = (
		<aside
			id="run-details"
			aria-label={title}
			onKeyDown={onKeyDown}
			className={cn(
				"relative flex flex-col bg-surface-1",
				files.phone
					? "min-h-0 flex-1"
					: "h-full w-[380px] shrink-0 shadow-[-1px_0_0_var(--hairline)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200",
			)}
			data-testid="run-details"
		>
			<div className="flex h-(--header-h) shrink-0 items-center gap-1.5 px-2">
				<Button
					variant="text"
					size="icon"
					aria-label="Close details"
					onClick={onClose}
					className="text-text-3"
					data-testid="run-details-close"
				>
					<X className="size-3.5" />
				</Button>
				<h2 className="min-w-0 flex-1 truncate text-heading">{title}</h2>
			</div>
			<TabsPrimitive.Root
				value={tab}
				onValueChange={(v) => onTab(v as DetailsTab)}
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="relative flex h-9 shrink-0 items-center px-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-hairline">
					<TabsPrimitive.List
						aria-label={title}
						className="flex min-w-0 gap-0.5 self-end"
					>
						{tabs.map((t) => (
							<TabsPrimitive.Trigger
								key={t.id}
								value={t.id}
								aria-label={t.aria}
								className="relative inline-flex h-[26px] items-center rounded-t-control px-2 text-text-2 transition-colors duration-(--dur-instant) hover:text-text-1 data-[state=active]:bg-surface-2 data-[state=active]:text-text-1 data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent"
								data-testid={`run-details-tab-${t.id}`}
							>
								{t.label}
								{t.aside}
							</TabsPrimitive.Trigger>
						))}
					</TabsPrimitive.List>
				</div>
				{files.viewing && (
					<TabsPrimitive.Content
						value="evidence"
						className="flex min-h-0 flex-1 flex-col"
						data-testid="run-details-evidence"
					>
						<EvidenceFileView
							key={`${files.viewing.sha}:${files.viewing.path}`}
							runId={files.runId}
							file={files.viewing}
							onBack={files.onClose}
							backLabel={files.backLabel}
							phone={files.phone}
							reads={files.reads}
							onJump={onJump}
							codeHost={files.codeHost}
						/>
					</TabsPrimitive.Content>
				)}
				{(["summary", "evidence", "context"] as const)
					.filter((id) => id !== "evidence" || !files.viewing)
					.map((id) => (
						<TabsPrimitive.Content
							key={id}
							value={id}
							className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-5"
							data-testid={`run-details-${id}`}
						>
							{id === "summary" && summaryTop}
							{id === "context" && contextTop}
							<Sections
								sections={
									id === "summary"
										? summary
										: id === "evidence"
											? evidence
											: context
								}
								incidentId={incidentId}
								onJump={onJump}
								onOpenFile={files.onOpen}
								onOpenHypotheses={files.onOpenHypotheses}
							/>
						</TabsPrimitive.Content>
					))}
				<TabsPrimitive.Content
					value="steps"
					className="flex min-h-0 flex-1 flex-col"
					data-testid="run-details-steps"
				>
					<fieldset
						aria-label="Show"
						className="m-0 flex min-w-0 shrink-0 gap-1 border-0 px-3 pt-2.5 pb-0"
					>
						{FILTERS.map((f) => (
							<button
								key={f.id}
								type="button"
								aria-pressed={f.id === filter}
								onClick={() => setFilter(f.id)}
								className={cn(
									"h-6 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
									f.id === filter
										? "bg-surface-3 text-text-1"
										: "text-text-2 hover:text-text-1",
								)}
								data-testid={`steps-filter-${f.id}`}
							>
								{f.label}
							</button>
						))}
					</fieldset>
					<ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-3 pt-3 pb-5">
						{shown.length === 0 && (
							<li className="px-2 py-1.5 text-text-2">
								{steps.length === 0
									? "This run ran no tools."
									: "No steps match."}
							</li>
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
										onClick={() =>
											file ? files.onOpen(file, id) : onJump(s.n)
										}
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
				</TabsPrimitive.Content>
			</TabsPrimitive.Root>
		</aside>
	);
	if (!files.phone) return aside;
	// A phone has no room beside the page: the details cover it as a modal sheet.
	// Its Esc closes once: the page's own Esc listener skips [role=dialog].
	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side="bottom"
				closeButton={false}
				aria-describedby={undefined}
				onCloseAutoFocus={(e) => e.preventDefault()}
				className="top-0 flex flex-col gap-0 bg-surface-1 p-0"
				data-testid="phone-sheet"
			>
				<SheetTitle className="sr-only">{title}</SheetTitle>
				{aside}
			</SheetContent>
		</Sheet>
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
				<span
					dir="auto"
					className={cn(
						row.tone ? TONE[row.tone] : "text-text-1",
						row.mono
							? "font-mono text-mono leading-5 [overflow-wrap:anywhere]"
							: "[overflow-wrap:anywhere]",
						row.strong && "font-semibold",
					)}
				>
					{row.text}
				</span>
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
		"self-start text-meta text-accent underline underline-offset-[3px] decoration-[oklch(from_var(--accent)_l_c_h/0.4)] hover:decoration-current";
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
			<section className="flex flex-col gap-1.5" aria-label="PrismaLens tools">
				<h3 className="text-meta font-semibold text-text-2">
					PrismaLens tools
				</h3>
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
						{hint.folder && <CommandChip command={hint.folder} />}
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
		</div>
	);
}
