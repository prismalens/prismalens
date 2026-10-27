// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Evidence and hypotheses the agent records through PrismaLens's own tool while
 * it works (#930). Code resolves each quote to a line (#740): a quote it cannot
 * find stays unanchored and is never verified.
 */
import type {
	Evidence,
	EvidenceDirection,
	Hypothesis,
	HypothesisStatus,
	InvestigationReport,
	QuoteAnchor,
	RecordedEvidence,
	RecordedHypothesis,
} from "@prismalens/contracts/schemas";

/** What one run may record, and how much tool output it keeps to resolve quotes against. */
export const FINDINGS_LIMITS = {
	evidence: 200,
	hypotheses: 50,
	outputs: 300,
	outputChars: 256_000,
} as const;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The 1-based line of `text` where `quote` starts. Verbatim, except that any run
 * of whitespace matches any other, since agents re-wrap what they copy.
 */
export function quoteLine(text: string, quote: string): number | null {
	const words = quote.trim().split(/\s+/).filter(Boolean);
	if (!words.length) return null;
	const m = new RegExp(words.map(escapeRegex).join("\\s+")).exec(text);
	return m ? text.slice(0, m.index).split("\n").length : null;
}

export interface EvidenceInput {
	observation: string;
	source: string;
	quote: string;
	direction: EvidenceDirection;
	path?: string;
}

export interface HypothesisInput {
	id?: string;
	statement: string;
	status: HypothesisStatus;
	evidence: string[];
	parentId?: string;
}

export interface Findings {
	evidence: RecordedEvidence[];
	hypotheses: RecordedHypothesis[];
}

/** One run's record: the tool outputs it saw, and what the agent recorded against them. */
export class FindingsLedger {
	private readonly outputs = new Map<string, string>();
	private readonly evidence = new Map<string, RecordedEvidence>();
	private readonly hypotheses = new Map<string, RecordedHypothesis>();

	/** A tool's output as the run saw it; the newest is searched first. */
	sawOutput(toolCallId: string, text: string): void {
		if (!toolCallId || !text) return;
		this.outputs.delete(toolCallId);
		this.outputs.set(toolCallId, text.slice(0, FINDINGS_LIMITS.outputChars));
		while (this.outputs.size > FINDINGS_LIMITS.outputs) {
			const oldest = this.outputs.keys().next().value;
			if (oldest === undefined) break;
			this.outputs.delete(oldest);
		}
	}

	/** The newest output holding the quote. */
	inOutputs(quote: string): QuoteAnchor | null {
		for (const [toolCallId, text] of [...this.outputs].reverse()) {
			const line = quoteLine(text, quote);
			if (line) return { in: "tool-output", toolCallId, line };
		}
		return null;
	}

	/** `fileAnchor` is the caller's lookup of `input.path`; without a path the outputs are searched. */
	addEvidence(
		input: EvidenceInput,
		fileAnchor: QuoteAnchor | null,
		at: string,
	): RecordedEvidence | { error: string } {
		if (this.evidence.size >= FINDINGS_LIMITS.evidence)
			return {
				error: `This run already holds ${FINDINGS_LIMITS.evidence} evidence items`,
			};
		const id = `e${this.evidence.size + 1}`;
		const item: RecordedEvidence = {
			id,
			observation: input.observation,
			source: input.source,
			quote: input.quote,
			direction: input.direction,
			...(input.path ? { path: input.path } : {}),
			anchor: input.path ? fileAnchor : this.inOutputs(input.quote),
			at,
		};
		this.evidence.set(id, item);
		return item;
	}

	addHypothesis(
		input: HypothesisInput,
		at: string,
	): RecordedHypothesis | { error: string } {
		const unknown = input.evidence.filter((id) => !this.evidence.has(id));
		if (unknown.length)
			return {
				error: `No recorded evidence ${unknown.join(", ")}; record it with evidence_record first`,
			};
		if (input.parentId && !this.hypotheses.has(input.parentId))
			return { error: `No recorded hypothesis ${input.parentId}` };
		const had = input.id ? this.hypotheses.get(input.id) : undefined;
		if (input.id && !had)
			return {
				error: `No recorded hypothesis ${input.id}; omit id to add one`,
			};
		if (!had && this.hypotheses.size >= FINDINGS_LIMITS.hypotheses)
			return {
				error: `This run already holds ${FINDINGS_LIMITS.hypotheses} hypotheses`,
			};
		const id = had?.id ?? `h${this.hypotheses.size + 1}`;
		const parentId = input.parentId ?? had?.parentId;
		const item: RecordedHypothesis = {
			id,
			statement: input.statement,
			status: input.status,
			evidenceIds: [
				...new Set([...(had?.evidenceIds ?? []), ...input.evidence]),
			],
			...(parentId && parentId !== id ? { parentId } : {}),
			at,
		};
		this.hypotheses.set(id, item);
		return item;
	}

	/** Evidence a quote did not resolve for is looked up again: its output may have landed after the call. */
	snapshot(): Findings {
		const evidence = [...this.evidence.values()].map((e) =>
			e.anchor || e.path ? e : { ...e, anchor: this.inOutputs(e.quote) },
		);
		return { evidence, hypotheses: [...this.hypotheses.values()] };
	}
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Recorded evidence as the report carries it: verified only where code found the quote. */
export function reportEvidence(e: RecordedEvidence): Evidence {
	const a = e.anchor;
	const source =
		a?.in === "file"
			? `${a.path}:${a.line}${norm(e.source) === norm(a.path) ? "" : ` (${e.source})`}`
			: e.source;
	return {
		observation: e.observation,
		source,
		direction: e.direction,
		status: a ? "verified" : "inferred",
		toolCallId: a?.in === "tool-output" ? a.toolCallId : null,
		quote: e.quote,
		anchor: a,
	};
}

type Body = Omit<InvestigationReport, "fidelity">;

/**
 * The report from the agent's final answer plus what it recorded (#930). A recorded
 * hypothesis joins the report's one with its id or statement, else follows the
 * report's own; an agent that recorded nothing gets its final answer unchanged.
 */
export function withFindings(report: Body, found: Findings): Body {
	if (!found.hypotheses.length) return report;
	const byId = new Map(found.evidence.map((e) => [e.id, reportEvidence(e)]));
	const hypotheses: Hypothesis[] = report.hypotheses.map((h) => ({ ...h }));
	for (const r of found.hypotheses) {
		const evidence = r.evidenceIds.flatMap((id) => byId.get(id) ?? []);
		const match = hypotheses.find(
			(h) =>
				(!!h.id && h.id === r.id) || norm(h.statement) === norm(r.statement),
		);
		if (!match) {
			hypotheses.push({
				statement: r.statement,
				status: r.status,
				evidence,
				id: r.id,
				...(r.parentId ? { parentId: r.parentId } : {}),
			});
			continue;
		}
		// The recorded copy wins: its status is what code found, not what the answer claims.
		const recorded = new Set(evidence.map((e) => norm(e.observation)));
		match.evidence = [
			...match.evidence.filter((e) => !recorded.has(norm(e.observation))),
			...evidence,
		];
	}
	return { ...report, hypotheses };
}
