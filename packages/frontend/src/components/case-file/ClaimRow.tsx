// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ClaimCoverage,
	ClaimStatus,
	ClaimView,
	CommandProvenance,
} from "@prismalens/contracts";
import { ChevronRight } from "lucide-react";
import { type StateTone, StateWord } from "@/components/shared/StateWord";

/** Status chips say the board's words (c01) and nothing else. */
const STATUS_TONE: Record<ClaimStatus, StateTone> = {
	hint: "quiet",
	candidate: "warn",
	observed: "ok",
	inferred: "accent",
	stated: "neutral",
	confirmed: "ok",
	inconclusive: "warn",
	unknown: "quiet",
};

export function statusWord(claim: Pick<ClaimView, "status" | "statusReason">) {
	return claim.statusReason
		? `${claim.status}(${claim.statusReason})`
		: claim.status;
}

export const PROVENANCE_WORD: Record<CommandProvenance, string> = {
	"host-executed": "PrismaLens ran this",
	"harness-reported": "The agent reported this",
	"harness-relayed": "The agent's harness relayed this",
	"shim-observed": "PrismaLens watched the agent run this",
};

const clock = (iso: string) =>
	new Date(iso).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});

export const missedWord = (from: string, to: string) =>
	`missed(${clock(from)}–${clock(to)})`;

/** `partial(byte-cap)`, `missed(03:14–05:40)`, or `complete`. */
export function coverageWords(coverage: ClaimCoverage | null): string[] {
	if (!coverage) return [];
	const words = [
		coverage.reason
			? `${coverage.retrieval}(${coverage.reason})`
			: coverage.retrieval,
	];
	if (coverage.missedFrom && coverage.missedTo)
		words.push(missedWord(coverage.missedFrom, coverage.missedTo));
	return words;
}

const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * One claim: status · statement · who ran it · population · coverage, with
 * where it came from and its revision folded underneath.
 */
export function ClaimRow({
	claim,
	onOpenArtifact,
}: {
	claim: ClaimView;
	onOpenArtifact: (artifactId: string) => void;
}) {
	const population = Object.entries(claim.population ?? {});
	return (
		<li className="py-2.5" data-testid="claim-row">
			<details className="group">
				<summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden">
					<ChevronRight className="size-3.5 shrink-0 self-center text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90" />
					<StateWord
						tone={STATUS_TONE[claim.status]}
						data-testid="claim-status"
					>
						{statusWord(claim)}
					</StateWord>
					<span className="min-w-0 text-body text-text-1">
						{claim.statement}
					</span>
					<span className="text-meta text-text-3" data-testid="claim-source">
						{PROVENANCE_WORD[claim.source.provenance]}
					</span>
					{population.map(([key, value]) => (
						<StateWord key={key} tone="neutral" mono>
							{key}={value}
						</StateWord>
					))}
					{coverageWords(claim.coverage).map((word) => (
						<StateWord
							key={word}
							tone={word === "complete" ? "quiet" : "warn"}
							data-testid="claim-coverage"
						>
							{word}
						</StateWord>
					))}
				</summary>
				<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-5 text-meta text-text-2">
					<dt className="text-text-3">Source</dt>
					<dd>
						{claim.source.kind}, {claim.source.provenance}
						{claim.source.artifactId && (
							<>
								{" · "}
								<button
									type="button"
									className="text-accent hover:underline"
									onClick={() =>
										claim.source.artifactId &&
										onOpenArtifact(claim.source.artifactId)
									}
									data-testid="claim-artifact"
								>
									Open the artifact
								</button>
							</>
						)}
					</dd>
					<dt className="text-text-3">Collected</dt>
					<dd className="tabular-nums">{at(claim.collectedAt)}</dd>
					<dt className="text-text-3">Recorded</dt>
					<dd className="tabular-nums">{at(claim.recordedAt)}</dd>
					<dt className="text-text-3">Revision</dt>
					<dd className="tabular-nums">
						revision {claim.revision} of {claim.revisions}
					</dd>
				</dl>
			</details>
			{claim.hint && (
				<p className="mt-1 pl-5 text-meta text-text-2" data-testid="claim-hint">
					{claim.hint}
				</p>
			)}
		</li>
	);
}
