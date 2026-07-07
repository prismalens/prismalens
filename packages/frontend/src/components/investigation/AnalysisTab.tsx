// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	InvestigationWithRelations,
	RunFidelity,
	RunFidelitySandbox,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { PriorityBadge } from "./investigation.utils";

interface AnalysisTabProps {
	investigation: InvestigationWithRelations;
}

/**
 * Honest run-metadata badge (ADR-0017) — surfaces the enforcement the rented
 * harness actually applied. Green = enforced, amber = cooperative, red = advisory.
 * Mechanism is shown on hover; nothing is inferred client-side.
 */
function FidelityBadge({ fidelity }: { fidelity: RunFidelity }) {
	const tone =
		fidelity.fidelity === "enforced"
			? "border-green-600 text-green-700 dark:text-green-400"
			: fidelity.fidelity === "cooperative"
				? "border-amber-600 text-amber-700 dark:text-amber-400"
				: "border-red-600 text-red-700 dark:text-red-500";

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Badge variant="outline" className={`gap-1 ${tone}`}>
						<span className="font-mono">{fidelity.mode}</span>
						<span className="opacity-60">·</span>
						<span className="capitalize">{fidelity.fidelity}</span>
					</Badge>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">
					<span className="font-mono">{fidelity.harness}</span> —{" "}
					{fidelity.mechanism}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * The Sandbox boundary (ADR-0020), when the structured `fidelity.sandbox` field
 * is present. Requested-vs-actual on hover so a silent-looking degrade (e.g.
 * `auto` -> `process-floor`) is never invisible.
 */
function SandboxBadge({ sandbox }: { sandbox: RunFidelitySandbox }) {
	const tone =
		sandbox.fidelity === "enforced"
			? "border-green-600 text-green-700 dark:text-green-400"
			: "border-amber-600 text-amber-700 dark:text-amber-400";

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Badge variant="outline" className={`gap-1 ${tone}`}>
						<span className="opacity-60">sandbox</span>
						<span className="font-mono">{sandbox.actual}</span>
					</Badge>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">
					requested <span className="font-mono">{sandbox.requested}</span> →
					actual <span className="font-mono">{sandbox.actual}</span> (
					{sandbox.fidelity})
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * Reduce overlay (ADR-0016 §5c) — app-side post-report enrichment computed BESIDE
 * the canonical report: deploy/change rows a hypothesis references + past incidents
 * scored similar. Renders only when the overlay is present and non-empty; degrades
 * to nothing otherwise (older investigations have no overlay).
 */
function OverlaySection({
	overlay,
}: {
	overlay: NonNullable<InvestigationWithRelations["overlay"]>;
}) {
	const { matchedChanges, similarIncidents } = overlay;
	if (matchedChanges.length === 0 && similarIncidents.length === 0) return null;

	return (
		<Card className="md:col-span-2">
			<CardHeader>
				<CardTitle className="text-base">
					Related changes &amp; similar incidents
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-6">
				{matchedChanges.length > 0 && (
					<div>
						<p className="text-sm text-muted-foreground mb-2">
							Changes correlated with a hypothesis ({matchedChanges.length})
						</p>
						<div className="space-y-2">
							{matchedChanges.map((change) => (
								<div
									key={`${change.kind}-${change.id}`}
									className="p-3 bg-muted rounded-lg text-sm"
								>
									<div className="flex items-start justify-between gap-3">
										<p className="font-medium">{change.title}</p>
										<Badge variant="outline" className="shrink-0 capitalize">
											{change.kind === "change_event" ? "change" : change.kind}
										</Badge>
									</div>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>{change.source}</span>
										{change.serviceName && (
											<>
												<span className="opacity-60">·</span>
												<span className="font-mono">{change.serviceName}</span>
											</>
										)}
										<span className="opacity-60">·</span>
										<span>{new Date(change.timestamp).toLocaleString()}</span>
										<span className="opacity-60">·</span>
										<span>
											hypothesis #{change.hypothesisIndex + 1} (matched{" "}
											<span className="font-mono">{change.matchedOn}</span>)
										</span>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{similarIncidents.length > 0 && (
					<div>
						<p className="text-sm text-muted-foreground mb-2">
							Similar past incidents ({similarIncidents.length})
						</p>
						<div className="space-y-2">
							{similarIncidents.map((similar) => (
								<div
									key={similar.incidentId}
									className="p-3 bg-muted rounded-lg flex items-start justify-between gap-3"
								>
									<div>
										<p className="font-medium">
											#{similar.incidentNumber} {similar.title}
										</p>
										<div className="mt-1 flex flex-wrap items-center gap-2">
											<Badge variant="secondary">
												{Math.round(similar.score * 100)}% match
											</Badge>
											{similar.factors.sameService && (
												<Badge variant="outline">same service</Badge>
											)}
											{similar.factors.sharedCategory && (
												<Badge variant="outline">same category</Badge>
											)}
										</div>
									</div>
									<Link
										to="/incidents/$id"
										params={{ id: similar.incidentId }}
										className="text-sm text-primary hover:underline shrink-0"
									>
										View incident
									</Link>
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function AnalysisTab({ investigation }: AnalysisTabProps) {
	const report = investigation.report ?? null;
	const overlay = investigation.overlay ?? null;

	return (
		<div className="grid gap-6 md:grid-cols-2">
			{/* Root Cause */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-3">
						<CardTitle className="text-base">Root Cause Analysis</CardTitle>
						<div className="flex items-center gap-2">
							{report?.fidelity && <FidelityBadge fidelity={report.fidelity} />}
							{report?.fidelity?.sandbox && (
								<SandboxBadge sandbox={report.fidelity.sandbox} />
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{investigation.rootCause ? (
						<div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
							<p className="text-purple-900 dark:text-purple-100 font-medium">
								{investigation.rootCause}
							</p>
							{investigation.rootCauseCategory && (
								<div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
									<Badge variant="outline">
										{investigation.rootCauseCategory}
									</Badge>
								</div>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Root cause analysis not available yet
						</p>
					)}
				</CardContent>
			</Card>

			{/* Coverage — what was queried vs not (ADR-0002, auditable) */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Coverage</CardTitle>
				</CardHeader>
				<CardContent>
					{report ? (
						<div className="space-y-3 text-sm">
							<div>
								<p className="text-muted-foreground mb-1">Queried</p>
								{report.coverage.queried.length > 0 ? (
									<div className="flex flex-wrap gap-2">
										{report.coverage.queried.map((source) => (
											<Badge key={source} variant="secondary">
												{source}
											</Badge>
										))}
									</div>
								) : (
									<p className="text-muted-foreground">None recorded</p>
								)}
							</div>
							{report.coverage.notQueried.length > 0 && (
								<div>
									<p className="text-muted-foreground mb-1">Not queried</p>
									<div className="flex flex-wrap gap-2">
										{report.coverage.notQueried.map((source) => (
											<Badge key={source} variant="outline">
												{source}
											</Badge>
										))}
									</div>
								</div>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No coverage recorded
						</p>
					)}
				</CardContent>
			</Card>

			{/* Hypotheses — ordered most → least plausible (ADR-0002) */}
			{report && report.hypotheses.length > 0 && (
				<Card className="md:col-span-2">
					<CardHeader>
						<CardTitle className="text-base">
							Hypotheses ({report.hypotheses.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ol className="space-y-3">
							{report.hypotheses.map((hypothesis, i) => (
								<li
									key={`${i}-${hypothesis.statement}`}
									className="p-3 bg-muted rounded-lg"
								>
									<div className="flex items-start justify-between gap-3">
										<p className="font-medium">
											{i + 1}. {hypothesis.statement}
										</p>
										<Badge variant="outline">{hypothesis.status}</Badge>
									</div>
									{hypothesis.evidence.length > 0 && (
										<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
											{hypothesis.evidence.map((evidence, j) => (
												<li
													key={`${j}-${evidence.observation}`}
													className="flex gap-2"
												>
													<span className="shrink-0 font-mono text-xs uppercase">
														{evidence.direction}
													</span>
													<span>
														{evidence.observation}
														<span className="ml-1 italic">
															({evidence.source})
														</span>
													</span>
												</li>
											))}
										</ul>
									)}
								</li>
							))}
						</ol>
					</CardContent>
				</Card>
			)}

			{/* Ruled Out */}
			{report && report.ruledOut.length > 0 && (
				<Card className="md:col-span-2">
					<CardHeader>
						<CardTitle className="text-base">
							Ruled Out ({report.ruledOut.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{report.ruledOut.map((item, i) => (
								<div
									key={`${i}-${item.statement}`}
									className="p-3 bg-muted rounded-lg"
								>
									<p className="font-medium">{item.statement}</p>
									<p className="text-sm text-muted-foreground mt-1">
										{item.why}
									</p>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Reduce overlay (ADR-0016 §5c) — related changes + similar incidents */}
			{overlay && <OverlaySection overlay={overlay} />}

			{/* Recommendations */}
			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle className="text-base">
						Recommendations ({investigation.recommendations?.length ?? 0})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.recommendations &&
					investigation.recommendations.length > 0 ? (
						<div className="space-y-3">
							{investigation.recommendations.map((rec) => (
								<div
									key={rec.id}
									className="p-3 bg-muted rounded-lg flex items-start justify-between"
								>
									<div>
										<p className="font-medium">{rec.title}</p>
										<div className="flex items-center gap-2 mt-1">
											<PriorityBadge priority={rec.priority} />
											<Badge variant="outline">{rec.status}</Badge>
										</div>
									</div>
									<Link
										to="/incidents/$id"
										params={{ id: investigation.incidentId }}
										className="text-sm text-primary hover:underline"
									>
										View in Incident
									</Link>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No recommendations generated yet
						</p>
					)}
				</CardContent>
			</Card>

			{/* Metadata */}
			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle className="text-base">Investigation Metadata</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">Started</span>
							<p className="font-medium">
								{investigation.startedAt
									? new Date(investigation.startedAt).toLocaleString()
									: "-"}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Completed</span>
							<p className="font-medium">
								{investigation.completedAt
									? new Date(investigation.completedAt).toLocaleString()
									: "-"}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Created</span>
							<p className="font-medium">
								{new Date(investigation.createdAt).toLocaleString()}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Last Updated</span>
							<p className="font-medium">
								{new Date(investigation.updatedAt).toLocaleString()}
							</p>
						</div>
					</div>

					{investigation.error && (
						<div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20">
							<p className="text-sm text-destructive font-medium">Error</p>
							<p className="text-sm text-destructive/80">
								{investigation.error}
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
