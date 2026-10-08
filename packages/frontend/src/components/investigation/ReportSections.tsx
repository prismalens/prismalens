// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	Evidence,
	InvestigationReport,
	InvestigationWithRelations,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RecordLink, TabSection } from "@/components/incidents/RecordLayout";
import { InlineCode } from "@/components/shared/InlineCode";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { answerWord } from "@/lib/answer-word";
import { refusalSentence } from "@/lib/refusal-sentence";
import {
	evidenceLabel,
	type Gap,
	gapsOf,
	groundedIn,
	type NowLine as NowFact,
	shortPath,
} from "@/lib/report-view";
import { sourceLabel } from "@/lib/source-label";
import { cn } from "@/lib/utils";

/** A list's rows, a hairline between them and nothing around them. */
const DIVIDED = "divide-y divide-hairline";

/**
 * The report's sections (study-v3 §3.2): structured fields laid out, with an
 * inline-only formatter for code spans; never the agent's Markdown.
 */

/** A line of evidence: which way it points, what was seen, and where to see it again. */
function EvidenceRow({
	label,
	tone,
	text,
	source,
	call,
	incidentId,
	investigationId,
}: {
	label: string;
	tone: "ok" | "danger" | "neutral";
	text: string;
	source: string | null;
	call?: string | null;
	incidentId: string;
	investigationId: string;
}) {
	return (
		<li
			className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3"
			data-testid="evidence-row"
		>
			<StateWord tone={tone} className="sm:pt-0.5" data-testid="evidence-label">
				{label}
			</StateWord>
			<div className="min-w-0 text-body [overflow-wrap:anywhere]">
				<p>
					<InlineCode text={text} />
				</p>
				{source && (
					<p className="mt-0.5 text-meta text-text-3">
						<span className="font-mono">{sourceLabel(source)}</span>
						{call && (
							<>
								{" "}
								<RecordLink
									incidentId={incidentId}
									to="conversation"
									search={{ investigation: investigationId, call }}
									className="font-sans"
									testId="evidence-open"
								>
									Open in the conversation
								</RecordLink>
							</>
						)}
					</p>
				)}
			</div>
		</li>
	);
}

interface ReportProps {
	incidentId: string;
	investigation: InvestigationWithRelations;
	report: InvestigationReport;
	events: readonly CanonicalEvent[];
}

/** One full stop, never two: the agent's text often ends with its own (#673). */
export function endSentence(text: string): string {
	const t = text.trim();
	return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The confidence word and its basis, then the conclusion in two lines with Show all. */
export function Answer({ report }: { report: InvestigationReport }) {
	const { word, tone, basis } = answerWord(report);
	const [all, setAll] = useState(false);
	const headline = useRef<HTMLHeadingElement>(null);
	const [clamped, setClamped] = useState(false);
	// Show all only when the two-line clamp actually cut the conclusion.
	useLayoutEffect(() => {
		const el = headline.current;
		if (el && !all) setClamped(el.scrollHeight > el.clientHeight + 1);
	});
	const c = report.culprit;
	const culprit = [
		c?.service ? `Code in ${c.service}.` : null,
		c?.changeRef ? `Introduced by \`${c.changeRef}\`.` : null,
		c?.mechanism
			? endSentence(
					`${c.mechanism.charAt(0).toUpperCase()}${c.mechanism.slice(1)}`,
				)
			: null,
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div className="mb-3" data-testid="report-answer">
			<p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-meta">
				<StateWord
					tone={tone}
					className="font-semibold"
					data-testid="report-answer-word"
				>
					{word}
				</StateWord>
				<span className="text-text-2">{basis}</span>
			</p>
			<div className="flex items-end gap-3">
				<h2
					className={cn(
						"min-w-0 flex-1 text-[18px] leading-6 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]",
						!all && "line-clamp-2",
					)}
					data-testid="report-headline"
					ref={headline}
				>
					<InlineCode
						text={
							report.rootCause ??
							`The run could not name a cause. ${report.summary}`
						}
					/>
				</h2>
				{(clamped || all) && (
					<Button
						variant="text"
						size="sm"
						onClick={() => setAll((v) => !v)}
						aria-expanded={all}
					>
						{all ? "Show less" : "Show all"}
					</Button>
				)}
			</div>
			{culprit && (
				<p
					className="mt-1 text-meta text-text-2 [overflow-wrap:anywhere]"
					data-testid="report-culprit"
				>
					<InlineCode text={culprit} />
				</p>
			)}
		</div>
	);
}

/** Cause, Do now and Alert at a glance, one pool of three cells above the fold. */
export function SummaryPool({
	investigation,
	report,
	alert,
	steps,
}: {
	investigation: InvestigationWithRelations;
	report: InvestigationReport;
	alert: { name: string; line: string; firing: boolean } | null;
	steps: { title: string; priority?: string | null; done: boolean }[];
}) {
	const { word, tone } = answerWord(report);
	const top = report.hypotheses.find((h) => h.status !== "refuted");
	const evidence = top?.evidence ?? [];
	const against = evidence.filter((e) => e.direction === "contradicts").length;
	const forIt = evidence.filter((e) => e.direction === "supports").length;
	const repo = investigation.workspace?.repos[0];
	const code = repo ? `in ${repo.name} at ${repo.head.slice(0, 7)}` : "";
	const first = steps[0];
	const done = steps.filter((s) => s.done).length;
	const cell = "grid min-w-0 gap-0.5";
	const k = "text-meta text-text-3";
	const s = "truncate text-meta text-text-2";
	return (
		<div
			className="pool mb-3 grid grid-cols-1 gap-4 px-3.5 py-3 md:grid-cols-3"
			data-testid="report-summary"
		>
			<div className={cell}>
				<span className={k}>Cause</span>
				<StateWord tone={tone} className="truncate text-body font-medium">
					{word}
				</StateWord>
				<span className={s}>
					{forIt} for, {against === 0 ? "none" : against} against
					{code ? `, ${code}` : ""}
				</span>
			</div>
			<div className={cell}>
				<span className={k}>Do now</span>
				<span className="flex min-w-0 items-baseline gap-2 text-body font-medium">
					<span className="truncate">
						{first ? first.title : "Nothing to do"}
					</span>
					{first?.priority && (
						<StateWord
							tone={
								first.priority === "critical" || first.priority === "high"
									? "danger"
									: "warn"
							}
							className="shrink-0 text-meta"
						>
							{first.priority}
						</StateWord>
					)}
				</span>
				<span className={s}>
					<a href="#do-now" className="text-accent hover:underline">
						{steps.length} step{steps.length === 1 ? "" : "s"}
					</a>
					, {done === 0 ? "none" : done} done
				</span>
			</div>
			<div className={cell}>
				<span className={k}>Alert</span>
				<span className="truncate text-body font-medium">
					{alert ? (alert.firing ? "Firing" : "Cleared") : "None"}
				</span>
				<span className={s}>
					{alert ? `${alert.name}, ${alert.line}` : "No alert is correlated"}
				</span>
			</div>
		</div>
	);
}

/** Still broken or not, from the incident's alerts (finding 5). */
export function Now({
	now,
	severity,
	className,
}: {
	now: NowFact | null;
	severity: string;
	className?: string;
}) {
	if (!now) return null;
	return (
		<p
			className={cn(
				"mt-3 flex items-center gap-2 text-body text-text-2",
				className,
			)}
			data-testid="report-now"
		>
			<span
				aria-hidden
				className="size-2 shrink-0 rounded-full"
				style={{ background: `var(--sev-${severity})` }}
			/>
			{now.text}
		</p>
	);
}

/** Why we think so: the cause's evidence, up to three lines. */
export function Why({
	incidentId,
	investigation,
	report,
	className,
}: Omit<ReportProps, "events"> & { className?: string }) {
	const cwd = investigation.workspace?.cwd;
	const row = (e: Evidence, i: number, label = evidenceLabel(e)) => (
		<EvidenceRow
			key={`${i}-${e.observation}`}
			label={label}
			tone={e.direction === "supports" ? "ok" : "danger"}
			text={e.observation}
			source={shortPath(e.source, cwd)}
			call={e.toolCallId}
			incidentId={incidentId}
			investigationId={investigation.id}
		/>
	);
	if (!report.rootCause) {
		const found = report.hypotheses.filter(
			(h) => h.status === "supported" || h.status === "confirmed",
		);
		return (
			<TabSection
				title="What it did find"
				className={className}
				testId="report-found"
			>
				{found.length === 0 ? (
					<p className="text-body text-text-2">
						Nothing it found is supported.
					</p>
				) : (
					<ul className={DIVIDED}>
						{found.map((h, i) => {
							const first = h.evidence[0];
							return (
								<EvidenceRow
									key={`${i}-${h.statement}`}
									label={
										h.evidence.some((e) => e.status === "verified")
											? "Seen"
											: "Inferred"
									}
									tone="ok"
									text={h.statement}
									source={first ? shortPath(first.source, cwd) : null}
									call={first?.toolCallId}
									incidentId={incidentId}
									investigationId={investigation.id}
								/>
							);
						})}
					</ul>
				)}
			</TabSection>
		);
	}
	const top = report.hypotheses.find((h) => h.status !== "refuted");
	const evidence = (top?.evidence ?? []).slice(0, 3);
	return (
		<TabSection
			title="Why we think so"
			className={className}
			testId="report-why"
		>
			{evidence.length === 0 ? (
				<p className="text-body text-text-2">The run recorded no evidence.</p>
			) : (
				<ul className={DIVIDED}>{evidence.map((e, i) => row(e, i))}</ul>
			)}
		</TabSection>
	);
}

/** A command, mono, two lines until Show. */
function Clamped({ text }: { text: string }) {
	const [all, setAll] = useState(false);
	return (
		<div className="flex items-start gap-2">
			<p
				className={cn(
					"min-w-0 flex-1 font-mono text-mono text-text-1",
					!all && "line-clamp-2",
				)}
			>
				{text}
			</p>
			{text.length > 90 && (
				<Button
					variant="text"
					size="sm"
					className="-my-0.5"
					onClick={() => setAll((v) => !v)}
					aria-expanded={all}
				>
					{all ? "Hide" : "Show"}
				</Button>
			)}
		</div>
	);
}

function GapRow({
	gap,
	incidentId,
	investigationId,
}: {
	gap: Gap;
	incidentId: string;
	investigationId: string;
}) {
	return (
		<li
			className="flex items-start gap-2.5 py-2 text-body"
			data-testid="report-gap"
		>
			<span
				aria-hidden
				className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn"
			/>
			{gap.kind === "refused" ? (
				<div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
					<Clamped text={gap.source} />
					<p className="mt-0.5 text-meta text-text-2">
						{refusalSentence(gap.reason)}{" "}
						<RecordLink
							incidentId={incidentId}
							to="conversation"
							search={{ investigation: investigationId, call: gap.toolCallId }}
						>
							See the refusal
						</RecordLink>
					</p>
				</div>
			) : (
				<p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
					<InlineCode text={gap.source} />: the run did not query it.
				</p>
			)}
		</li>
	);
}

/** What we could not check: refusals and what the run says it did not query. */
export function Gaps({
	incidentId,
	investigation,
	report,
	events,
	className,
}: ReportProps & { className?: string }) {
	const gaps = gapsOf(report, events, investigation.workspace?.cwd);
	return (
		<TabSection
			title="What we could not check"
			className={className}
			testId="report-gaps"
		>
			{gaps.length === 0 ? (
				<p className="text-body text-text-2">
					The run named nothing it could not check.
				</p>
			) : (
				<ul className={DIVIDED}>
					{gaps.map((g) => (
						<GapRow
							key={g.kind === "refused" ? g.toolCallId : g.source}
							gap={g}
							incidentId={incidentId}
							investigationId={investigation.id}
						/>
					))}
				</ul>
			)}
		</TabSection>
	);
}

/** Ruled out, each with what ruled it out. */
export function RuledOut({
	incidentId,
	investigation,
	report,
	className,
}: Omit<ReportProps, "events"> & { className?: string }) {
	if (report.ruledOut.length === 0) return null;
	return (
		<TabSection
			title="Ruled out"
			count={report.ruledOut.length}
			className={className}
			testId="report-ruled-out"
		>
			<ul className={DIVIDED}>
				{report.ruledOut.map((r, i) => {
					const first = r.evidence[0];
					return (
						<EvidenceRow
							key={`${i}-${r.statement}`}
							label="Against"
							tone="danger"
							text={`${r.statement}: ${r.why}`}
							source={
								first
									? shortPath(first.source, investigation.workspace?.cwd)
									: null
							}
							call={first?.toolCallId}
							incidentId={incidentId}
							investigationId={investigation.id}
						/>
					);
				})}
			</ul>
		</TabSection>
	);
}

/** Every source the answer stands on, one per line. */
export function Grounded({
	investigation,
	report,
	className,
}: {
	investigation: InvestigationWithRelations;
	report: InvestigationReport;
	className?: string;
}) {
	const sources = groundedIn(report, investigation.workspace?.cwd);
	return (
		<TabSection
			title="Grounded in"
			count={sources.length}
			className={className}
			testId="report-grounded"
		>
			{sources.length === 0 ? (
				<p className="text-body text-text-2">The run recorded no sources.</p>
			) : (
				<ul className="space-y-1">
					{sources.map((s) => (
						<li
							key={s}
							className="font-mono text-mono text-text-2 [overflow-wrap:anywhere]"
							data-testid="report-grounded-row"
						>
							{sourceLabel(s)}
						</li>
					))}
				</ul>
			)}
		</TabSection>
	);
}

/** Whether anything the agent read tried to instruct it (#207). */
export function Integrity({
	report,
	className,
}: {
	report: InvestigationReport;
	className?: string;
}) {
	const flagged = report.flaggedContent ?? [];
	if (flagged.length === 0)
		return (
			<p
				className={cn("mt-8 text-meta text-text-3", className)}
				data-testid="flagged-content"
			>
				Nothing in the alert payloads or the files tried to instruct the agent.
			</p>
		);
	return (
		<TabSection
			title="Content that tried to instruct the agent"
			count={flagged.length}
			className={className}
			testId="flagged-content"
		>
			<p className="mb-1 text-body text-text-2">
				The agent ignored these lines; weigh the evidence they sit next to.
			</p>
			<ul className={DIVIDED}>
				{flagged.map((f, i) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: quotes can repeat
						key={i}
						className="py-2 text-body"
					>
						<span className="text-danger">“{f.quote}”</span>
						<span className="block text-meta text-text-3">
							{f.where === "context-pack" ? "In the brief" : "In tool output"}:{" "}
							{f.why}
						</span>
					</li>
				))}
			</ul>
		</TabSection>
	);
}

/** A past incident the reduce step ranked as similar, with its recorded cause. */
export function Similar({
	investigation,
	className,
}: {
	investigation: InvestigationWithRelations;
	className?: string;
}) {
	const similar = investigation.overlay?.similarIncidents ?? [];
	if (similar.length === 0) return null;
	return (
		<TabSection
			title="Similar past incidents"
			count={similar.length}
			className={className}
		>
			<ul className={DIVIDED}>
				{similar.map((s) => (
					<li key={s.incidentId} className="py-2">
						<Link
							to="/incidents/$id"
							params={{ id: s.incidentId }}
							className="text-body hover:text-accent"
						>
							<span className="mr-1.5 font-mono text-meta text-text-3">
								INC-{s.incidentNumber}
							</span>
							{s.title}
						</Link>
						<p className="text-meta text-text-3">
							{s.actualCause
								? `Cause: ${s.actualCause}`
								: `Matched on ${s.matchedOn.join(", ")}`}
						</p>
					</li>
				))}
			</ul>
		</TabSection>
	);
}

/** Copies the hand-off for the operator's own coding agent; it says when it did. */
export function CopyFixBrief({
	text,
	label = "Copy fix brief for your agent",
	variant = "secondary",
	className,
}: {
	text: string;
	label?: string;
	variant?: "secondary" | "text";
	className?: string;
}) {
	const { toast } = useToast();
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	return (
		<Button
			variant={variant}
			className={className}
			onClick={() =>
				navigator.clipboard.writeText(text).then(
					() => {
						setCopied(true);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => setCopied(false), 2000);
					},
					() =>
						toast({
							title: "Not copied",
							description: "The browser did not allow the clipboard.",
							variant: "destructive",
						}),
				)
			}
			data-testid="copy-fix-brief"
		>
			{copied ? "Copied" : label}
		</Button>
	);
}
