// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CaptureSummary,
	CaseView,
	ClaimView,
	ManifestVerify,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { RecordSection } from "@/components/shared/RecordSection";
import { Empty } from "@/components/shared/State";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	useCaseFileEnabled,
	useVerifyCase,
} from "@/lib/api/hooks/use-case-files-orpc";
import { ArtifactDrawer } from "./ArtifactDrawer";
import { ClaimRow, missedWord, PROVENANCE_WORD } from "./ClaimRow";

type Binding = CaseView["binding"];

function identityWord(matches: boolean | null): string {
	if (matches === null) return "identity not checked";
	return matches
		? "identity matches binding"
		: "identity does not match binding";
}

/** "Captured kind-pl/shop 42 s after the alert · complete · identity matches binding". */
export function captureLine(capture: CaptureSummary, binding: Binding): string {
	const target = binding
		? `${binding.kubeContext}/${binding.namespace}`
		: (capture.identity?.kubeContext ?? "the bound target");
	switch (capture.state) {
		case "queued":
			return `Capture of ${target} queued`;
		case "running":
			return `Capturing ${target}…`;
		case "blocked":
			return `Capture of ${target} blocked: ${capture.stateReason ?? "no reason given"}`;
		case "skipped":
			return `Capture of ${target} skipped`;
		default: {
			const after =
				capture.latencyMs === null
					? ""
					: ` ${Math.round(capture.latencyMs / 1000)} s after the alert`;
			return `Captured ${target}${after} · ${capture.state} · ${identityWord(capture.identityMatches)}`;
		}
	}
}

/** `partial(reason)`, `missed(03:14–05:40)`, `skipped(queue-full)`, and whether it was shared. */
export function captureChips(capture: CaptureSummary): string[] {
	const partial = capture.artifacts
		.filter((a) => a.retrieval === "partial")
		.map((a) => `partial(${a.retrievalReason ?? "error"})`);
	return [
		...Array.from(new Set(partial)),
		...(capture.missed
			? [missedWord(capture.missed.from, capture.missed.to)]
			: []),
		...(capture.state === "skipped"
			? [`skipped(${capture.stateReason ?? "unknown"})`]
			: []),
		...(capture.shared ? ["shared with another incident"] : []),
	];
}

export function verifyWords(result: ManifestVerify): string {
	return result.brokenAt
		? `Broken at entry ${result.brokenAt.seq}: ${result.brokenAt.check}`
		: `Record intact (${result.entries} entries)`;
}

/** The workload a claim is about: its population's, else the edge's source, else its subject. */
function workloadOf(claim: ClaimView): string {
	return (
		claim.population?.workload ??
		(claim.subject.kind === "edge" ? claim.subject.from : undefined) ??
		claim.subject.label
	);
}

function groupByWorkload(claims: ClaimView[]): [string, ClaimView[]][] {
	const groups = new Map<string, ClaimView[]>();
	for (const claim of claims) {
		const key = workloadOf(claim);
		groups.set(key, [...(groups.get(key) ?? []), claim]);
	}
	return Array.from(groups.entries());
}

/**
 * The incident's case (s09): the capture, what is still open, what was
 * observed, the agent's account and every command behind them.
 */
export function CaseFileView({
	incidentId,
	view,
}: {
	incidentId: string;
	view: CaseView;
}) {
	const [artifactId, setArtifactId] = useState<string | null>(null);
	const verify = useVerifyCase();
	const open = new Set(view.openQuestions);
	const report = view.claims.filter((c) => c.source.kind === "report");
	const observed = view.claims.filter(
		(c) => c.source.kind !== "report" && !open.has(c.id),
	);
	const gaps = view.claims.filter(
		(c) => c.projected && c.status === "unknown" && c.hint,
	);
	const artifacts = view.captures.flatMap((c) => c.artifacts);
	const row = (claim: ClaimView) => (
		<ClaimRow key={claim.id} claim={claim} onOpenArtifact={setArtifactId} />
	);

	return (
		<div data-testid="case-file-view">
			<section
				className="flex flex-col gap-2"
				aria-label="Capture"
				data-testid="case-capture"
			>
				{view.captures.length === 0 &&
					(gaps.length === 0 ? (
						<p className="text-body text-text-2">
							No capture for this incident.
						</p>
					) : (
						gaps.map((gap) => (
							<div key={gap.id} data-testid="case-gap">
								<p className="text-body text-text-1">{gap.statement}</p>
								<p className="text-meta text-text-2">{gap.hint}</p>
							</div>
						))
					))}
				{view.captures.map((capture) => (
					<div
						key={capture.id}
						className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
						data-testid="case-capture-line"
					>
						<span className="text-body text-text-1">
							{captureLine(capture, view.binding)}
						</span>
						{captureChips(capture).map((chip) => (
							<StateWord key={chip} tone="warn" data-testid="case-chip">
								{chip}
							</StateWord>
						))}
					</div>
				))}
				<div className="flex flex-wrap items-center gap-3">
					<Button
						variant="secondary"
						size="sm"
						disabled={verify.isPending || view.manifest.entries === 0}
						onClick={() => verify.mutate({ incidentId })}
						data-testid="case-verify"
					>
						Verify record
					</Button>
					{verify.data && (
						<StateWord
							tone={verify.data.ok ? "ok" : "danger"}
							data-testid="case-verify-result"
						>
							{verifyWords(verify.data)}
						</StateWord>
					)}
					<MutationError error={verify.error} />
				</div>
			</section>

			<RecordSection
				id="open-questions"
				title="Open questions"
				count={open.size}
				className="mt-8"
			>
				{open.size === 0 ? (
					<Empty text="Nothing open." />
				) : (
					<ul className="divide-y divide-hairline">
						{view.claims.filter((c) => open.has(c.id)).map(row)}
					</ul>
				)}
			</RecordSection>

			<RecordSection id="observed" title="Observed" count={observed.length}>
				{observed.length === 0 ? (
					<Empty text="Nothing observed yet." />
				) : (
					groupByWorkload(observed).map(([workload, claims]) => (
						<div key={workload} className="py-2" data-testid="case-workload">
							<Mono className="text-meta text-text-3">{workload}</Mono>
							<ul className="divide-y divide-hairline">{claims.map(row)}</ul>
						</div>
					))
				)}
			</RecordSection>

			<RecordSection
				id="agent-account"
				title="The agent's account"
				count={report.length}
			>
				{report.length === 0 ? (
					<Empty text="No report yet." />
				) : (
					<ul className="divide-y divide-hairline">{report.map(row)}</ul>
				)}
			</RecordSection>

			<RecordSection
				id="commands"
				title="Commands"
				count={artifacts.length + view.agentToolCalls.length}
			>
				{artifacts.length + view.agentToolCalls.length === 0 ? (
					<Empty text="No commands yet." />
				) : (
					<ul className="divide-y divide-hairline">
						{artifacts.map((a) => (
							<li
								key={a.id}
								className="flex flex-wrap items-baseline gap-x-2 py-2.5"
								data-testid="case-command"
							>
								<button
									type="button"
									className="min-w-0 break-all text-left font-mono text-meta text-text-1 hover:underline disabled:no-underline"
									disabled={a.withheld || a.expired}
									onClick={() => setArtifactId(a.id)}
								>
									{a.command.join(" ")}
								</button>
								<StateWord tone={a.retrieval === "partial" ? "warn" : "quiet"}>
									{a.retrievalReason
										? `${a.retrieval}(${a.retrievalReason})`
										: a.retrieval}
								</StateWord>
								{a.withheld && <StateWord tone="danger">withheld</StateWord>}
								{a.expired && <StateWord tone="quiet">expired</StateWord>}
								<span className="text-meta text-text-3">
									{PROVENANCE_WORD["host-executed"]}
								</span>
							</li>
						))}
						{view.agentToolCalls.map((call) => (
							<li
								key={`${call.investigationId}-${call.toolCallId}`}
								className="flex flex-wrap items-baseline gap-x-2 py-2.5"
								data-testid="case-tool-call"
							>
								<Mono className="text-meta text-text-1">{call.name}</Mono>
								<span className="min-w-0 truncate text-meta text-text-2">
									{call.source}
								</span>
								<span className="text-meta text-text-3">
									{PROVENANCE_WORD[call.provenance]}
								</span>
							</li>
						))}
					</ul>
				)}
			</RecordSection>

			<ArtifactDrawer
				artifactId={artifactId}
				onClose={() => setArtifactId(null)}
			/>
		</div>
	);
}

/** The overview header's way into the case, shown only while the setting is on. */
export function CaseFileLink({ incidentId }: { incidentId: string }) {
	const enabled = useCaseFileEnabled();
	if (!enabled) return null;
	return (
		<Button variant="text" size="sm" className="shrink-0 max-sm:hidden" asChild>
			<Link
				to="/incidents/$id/case"
				params={{ id: incidentId }}
				data-testid="header-case-file"
			>
				Case File
			</Link>
		</Button>
	);
}
