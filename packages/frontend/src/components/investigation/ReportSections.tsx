// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type Culprit,
	EVIDENCE_STATUS_LABEL,
	FIDELITY_LABEL,
	HYPOTHESIS_STATUS_LABEL,
	type InvestigationWithRelations,
	MODEL_SOURCE_LABEL,
	ROOT_CAUSE_CATEGORY_LABEL,
	type RunFidelity,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check } from "lucide-react";

import { Mono } from "@/components/shared/Mono";
import { ProvenanceStamp } from "@/components/shared/ProvenanceStamp";
import { RecordSection } from "@/components/shared/RecordSection";
import { StateChip } from "@/components/shared/StateChip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format-time";
import {
	evidenceStatusTone,
	fidelityTone,
	hypothesisStatusTone,
} from "@/lib/state-tone";
import { ExportReportButton } from "./ExportReportButton";
import { PriorityBadge } from "./investigation.utils";
import { PostToGitHubButton } from "./PostToGitHubButton";

/**
 * Honest run-metadata badge (ADR-0017): which agent ran, at which version,
 * and the enforcement it actually applied. Model and mechanism on hover;
 * nothing inferred client-side.
 */
export function FidelityBadge({ fidelity }: { fidelity: RunFidelity }) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<StateChip tone={fidelityTone(fidelity.fidelity)}>
						<span className="font-mono">
							{fidelity.harness}
							{fidelity.harnessVersion && ` ${fidelity.harnessVersion}`}
						</span>
						<span className="opacity-60">·</span>
						<span className="font-mono">{fidelity.mode}</span>
						<span className="opacity-60">·</span>
						<span>{FIDELITY_LABEL[fidelity.fidelity]}</span>
					</StateChip>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">
					<p>
						Model:{" "}
						{fidelity.model ? (
							<>
								<span className="font-mono">{fidelity.model}</span>
								{fidelity.modelSource &&
									`, ${MODEL_SOURCE_LABEL[fidelity.modelSource]}`}
							</>
						) : (
							"the agent's default"
						)}
					</p>
					<p>Read-only: {fidelity.mechanism}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * Structured culprit (ADR-0026 / D3): service / changeRef / mechanism, each
 * independently nullable. Identification only, never a toned badge.
 */
function CulpritRow({ culprit }: { culprit: Culprit }) {
	const { service, changeRef, mechanism } = culprit;
	if (!service && !changeRef && !mechanism) return null;
	return (
		<dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-record sm:grid-cols-3">
			<div>
				<dt className="text-meta text-muted-foreground">Service</dt>
				<dd className="font-mono">{service ?? "—"}</dd>
			</div>
			<div>
				<dt className="text-meta text-muted-foreground">Change ref</dt>
				<dd className="truncate font-mono" title={changeRef ?? undefined}>
					{changeRef ?? "—"}
				</dd>
			</div>
			<div>
				<dt className="text-meta text-muted-foreground">Mechanism</dt>
				<dd>{mechanism ?? "—"}</dd>
			</div>
		</dl>
	);
}

interface ReportSectionProps {
	investigation: InvestigationWithRelations;
}

/**
 * The report: root cause, what it is grounded in, next steps. Grounding is the
 * list of sources the run actually queried, never a number (ADR-0002).
 */
export function ReportSection({ investigation }: ReportSectionProps) {
	const report = investigation.report ?? null;
	const completedAt = investigation.completedAt ?? investigation.updatedAt;

	return (
		<RecordSection
			id="report"
			title="Report"
			actions={
				report ? (
					<>
						{report.fidelity && <FidelityBadge fidelity={report.fidelity} />}
						<ExportReportButton investigationId={investigation.id} />
						{investigation.status === "completed" && (
							<PostToGitHubButton investigationId={investigation.id} />
						)}
					</>
				) : undefined
			}
		>
			{investigation.rootCause ? (
				<div className="rounded-md border border-primary/30 bg-primary/8 p-4">
					<p className="text-base font-medium leading-snug">
						{investigation.rootCause}
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						{investigation.rootCauseCategory && (
							<StateChip tone="primary">
								{ROOT_CAUSE_CATEGORY_LABEL[investigation.rootCauseCategory]}
							</StateChip>
						)}
						<ProvenanceStamp capturedAt={completedAt} source="report" />
					</div>
					{report?.culprit && <CulpritRow culprit={report.culprit} />}
				</div>
			) : (
				<p className="text-record text-muted-foreground">
					{investigation.status === "completed"
						? "The run finished without naming a root cause. The evidence below is what it found."
						: "The run failed before a root cause was found."}
				</p>
			)}

			{report && (
				<div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-record">
					<span className="text-muted-foreground">Grounded in</span>
					{report.coverage.queried.length > 0 ? (
						report.coverage.queried.map((source) => (
							<StateChip key={source} tone="done" mono>
								{source}
							</StateChip>
						))
					) : (
						<span className="text-muted-foreground">nothing recorded</span>
					)}
					{report.coverage.notQueried.length > 0 && (
						<>
							<span className="ml-2 text-muted-foreground">Not queried</span>
							{report.coverage.notQueried.map((source) => (
								<StateChip key={source} tone="neutral" mono dashed>
									{source}
								</StateChip>
							))}
						</>
					)}
				</div>
			)}

			{report && report.nextSteps.length > 0 && (
				<div className="mt-4" data-testid="next-steps">
					<h3 className="mb-2 text-record font-medium">Next steps</h3>
					<ol className="space-y-2">
						{report.nextSteps.map((step, i) => (
							<li key={`${i}-${step.title}`} className="flex gap-3 text-record">
								<Mono className="w-4 shrink-0 text-muted-foreground">
									{i + 1}
								</Mono>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">{step.title}</span>
										{step.priority && (
											<PriorityBadge priority={step.priority} />
										)}
										<span className="font-mono text-meta text-muted-foreground">
											not executed by PrismaLens
										</span>
									</div>
									<p className="text-muted-foreground">{step.detail}</p>
								</div>
							</li>
						))}
					</ol>
				</div>
			)}

			{investigation.error && (
				<p className="mt-3 rounded border border-run-failed/30 bg-run-failed/8 p-3 font-mono text-meta text-run-failed">
					{investigation.error}
				</p>
			)}
		</RecordSection>
	);
}

/**
 * Evidence by decisiveness: hypotheses in the run's order with their named
 * evidence, then what was ruled out with the evidence that killed it, then the
 * integrity row, rendered even at zero so its absence is never ambiguous.
 */
export function EvidenceSection({ investigation }: ReportSectionProps) {
	const report = investigation.report ?? null;
	if (!report) return null;
	const overlay = investigation.overlay ?? null;
	const flagged = report.flaggedContent ?? [];
	const changes = overlay?.matchedChanges ?? [];
	const total = report.hypotheses.length + report.ruledOut.length;

	return (
		<RecordSection id="evidence" title="Evidence" count={total}>
			{report.hypotheses.length > 0 && (
				<ol className="space-y-2">
					{report.hypotheses.map((hypothesis, i) => (
						<li
							key={`${i}-${hypothesis.statement}`}
							className="rounded-md border border-l-2 border-l-run-done/70 p-3"
						>
							<div className="flex items-start justify-between gap-3">
								<p className="text-record font-medium">
									{hypothesis.statement}
								</p>
								<StateChip tone={hypothesisStatusTone(hypothesis.status)}>
									{HYPOTHESIS_STATUS_LABEL[hypothesis.status]}
								</StateChip>
							</div>
							{hypothesis.evidence.length > 0 && (
								<ul className="mt-2 space-y-1">
									{hypothesis.evidence.map((evidence, j) => (
										<li
											key={`${j}-${evidence.observation}`}
											className="flex flex-wrap items-baseline gap-x-2 text-record text-muted-foreground"
										>
											<Mono className="text-meta uppercase text-foreground/70">
												{evidence.direction}
											</Mono>
											<span>{evidence.observation}</span>
											<Mono className="text-meta">{evidence.source}</Mono>
										</li>
									))}
								</ul>
							)}
						</li>
					))}
				</ol>
			)}

			{report.ruledOut.length > 0 && (
				<div className="mt-3 space-y-2">
					{report.ruledOut.map((item, i) => (
						<div
							key={`${i}-${item.statement}`}
							className="rounded-md border border-l-2 border-l-border p-3 text-muted-foreground"
						>
							<div className="flex flex-wrap items-baseline gap-2">
								<StateChip tone="neutral">ruled out</StateChip>
								<p className="text-record font-medium text-foreground/80">
									{item.statement}
								</p>
							</div>
							<p className="mt-1 text-record">{item.why}</p>
							{item.evidence.length > 0 && (
								<ul className="mt-2 space-y-1" data-testid="ruled-out-evidence">
									{item.evidence.map((ev, j) => (
										<li
											key={`${j}-${ev.source}`}
											className="flex flex-wrap items-baseline gap-x-2 text-meta"
										>
											<Mono>{ev.source}</Mono>
											<span>{ev.observation}</span>
											<StateChip
												tone={evidenceStatusTone(ev.status)}
												className="h-4"
											>
												{EVIDENCE_STATUS_LABEL[ev.status]}
											</StateChip>
										</li>
									))}
								</ul>
							)}
						</div>
					))}
				</div>
			)}

			{changes.length > 0 && (
				<div className="mt-3">
					<h3 className="mb-2 text-record font-medium">
						Changes correlated with a hypothesis
					</h3>
					<ul className="space-y-1">
						{changes.map((change) => (
							<li
								key={`${change.kind}-${change.id}`}
								className="flex flex-wrap items-baseline gap-x-2 text-record"
							>
								<StateChip tone="neutral">
									{change.kind === "change_event" ? "change" : change.kind}
								</StateChip>
								<span className="font-medium">{change.title}</span>
								<Mono className="text-meta text-muted-foreground">
									{change.source}
									{change.serviceName ? ` · ${change.serviceName}` : ""} ·{" "}
									{formatDateTime(change.timestamp)} · hypothesis #
									{change.hypothesisIndex + 1} · {change.matchedOn}
								</Mono>
							</li>
						))}
					</ul>
				</div>
			)}

			{flagged.length > 0 ? (
				<Alert
					variant="destructive"
					className="mt-3"
					data-testid="flagged-content"
				>
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>
						Content tried to instruct the agent ({flagged.length})
					</AlertTitle>
					<AlertDescription>
						<p className="mb-2">
							These lines in what the agent read looked like instructions rather
							than data. The agent ignored them; weigh the evidence they sit
							next to.
						</p>
						<ul className="space-y-1 text-xs">
							{flagged.map((f, i) => (
								<li key={`${i}-${f.quote}`}>
									<span className="font-mono">{f.where}</span>: “{f.quote}” —{" "}
									{f.why}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : (
				<p
					className="mt-3 flex items-center gap-2 border-t border-dashed pt-2 text-meta text-muted-foreground"
					data-testid="flagged-content"
				>
					<Check className="h-3.5 w-3.5 text-run-done" />
					Content integrity: 0 items flagged across alert payloads and
					repository files
					<Mono className="ml-auto text-meta">report.flaggedContent</Mono>
				</p>
			)}
		</RecordSection>
	);
}

/** A past incident the reduce step ranked as similar, with the reasons and its recorded cause. */
export function SimilarIncidentRow({
	similar,
}: {
	similar: NonNullable<
		InvestigationWithRelations["overlay"]
	>["similarIncidents"][number];
}) {
	return (
		<li className="space-y-1 py-2 first:pt-0 last:pb-0">
			<div className="flex items-baseline gap-2">
				<Mono className="text-meta text-muted-foreground">#{similar.rank}</Mono>
				<Link
					to="/incidents/$id"
					params={{ id: similar.incidentId }}
					className="min-w-0 truncate text-record font-medium hover:underline"
				>
					<Mono className="mr-1 text-muted-foreground">
						INC-{similar.incidentNumber}
					</Mono>
					{similar.title}
				</Link>
			</div>
			<div className="flex flex-wrap gap-1">
				{similar.matchedOn.map((reason) => (
					<StateChip key={reason} tone="neutral">
						{reason}
					</StateChip>
				))}
			</div>
			{similar.actualCause && (
				<p className="text-record">
					<span className="text-muted-foreground">Actual cause: </span>
					{similar.actualCause}
				</p>
			)}
		</li>
	);
}
