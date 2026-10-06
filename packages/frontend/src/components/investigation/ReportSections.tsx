// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	Evidence,
	InvestigationReport,
	InvestigationWithRelations,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
			className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3"
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
						<span className="font-mono">{source}</span>
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

/** The answer with its confidence word, and the culprit in one line. */
export function Answer({ report }: { report: InvestigationReport }) {
	const { word, tone, basis } = answerWord(report);
	const c = report.culprit;
	const culprit = [
		c?.service ? `Code in ${c.service}.` : null,
		c?.changeRef ? `Introduced by \`${c.changeRef}\`.` : null,
		c?.mechanism
			? `${c.mechanism.charAt(0).toUpperCase()}${c.mechanism.slice(1)}.`
			: null,
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div data-testid="report-answer">
			<p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-body">
				<StateWord
					tone={tone}
					className="text-body"
					data-testid="report-answer-word"
				>
					{word}
				</StateWord>
				<span className="text-text-3">{basis}</span>
			</p>
			<h2
				className="text-display [overflow-wrap:anywhere]"
				data-testid="report-headline"
			>
				<InlineCode
					text={
						report.rootCause ??
						`The run could not name a cause. ${report.summary}`
					}
				/>
			</h2>
			{culprit && (
				<p className="mt-2 text-body text-text-2">
					<InlineCode text={culprit} />
				</p>
			)}
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
					<p className="font-mono text-mono text-text-1">{gap.source}</p>
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
							{s}
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

/**
 * Below 1280, where the rail is not: the way to the run itself. Its agent,
 * model and time are on the strip above (look ruling L45).
 */
export function RunLine({
	incidentId,
	investigationId,
	className,
}: {
	incidentId: string;
	investigationId: string;
	className?: string;
}) {
	return (
		<p
			className={cn(
				"mt-8 flex flex-wrap gap-x-3.5 gap-y-1 text-meta",
				className,
			)}
			data-testid="report-run-line"
		>
			<RecordLink
				incidentId={incidentId}
				to="conversation"
				search={{ investigation: investigationId }}
			>
				Conversation
			</RecordLink>
			<RecordLink
				incidentId={incidentId}
				to="conversation"
				search={{ investigation: investigationId, ledger: "1" }}
			>
				Event log
			</RecordLink>
		</p>
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
