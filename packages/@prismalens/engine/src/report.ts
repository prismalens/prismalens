// The submit_report tool + defensive parsing of the model's structured report.
// Enforces ADR-0002: ordered hypotheses + evidence status, NO numeric confidence.

import type {
	Evidence,
	EvidenceDirection,
	EvidenceStatus,
	Hypothesis,
	Recommendation,
	Report,
	ToolDef,
} from "./types.js";

export const submitReportTool: ToolDef = {
	name: "submit_report",
	description:
		"Call this ONCE to finish the investigation. Provide a summary, the root cause (empty string if undetermined), an ORDERED list of hypotheses (rank 1 = most likely), each with its evidence, and recommendations. Do NOT include any numeric confidence or probability — ranking plus evidence status carries the certainty. Mark each evidence `verified` ONLY if a tool you ran directly showed it; otherwise `inferred`.",
	parameters: {
		type: "object",
		properties: {
			summary: { type: "string", description: "Short narrative of what happened and what you found" },
			rootCause: { type: "string", description: "Most likely root cause, or empty string if undetermined" },
			hypotheses: {
				type: "array",
				items: {
					type: "object",
					properties: {
						rank: { type: "integer", description: "1 = most likely" },
						statement: { type: "string" },
						evidence: {
							type: "array",
							items: {
								type: "object",
								properties: {
									observation: { type: "string" },
									source: { type: "string", description: "the command or origin that produced it" },
									direction: { type: "string", enum: ["supports", "contradicts"] },
									status: { type: "string", enum: ["verified", "inferred"] },
								},
								required: ["observation", "source", "direction", "status"],
							},
						},
					},
					required: ["rank", "statement", "evidence"],
				},
			},
			recommendations: {
				type: "array",
				items: {
					type: "object",
					properties: {
						title: { type: "string" },
						detail: { type: "string" },
					},
					required: ["title", "detail"],
				},
			},
		},
		required: ["summary", "hypotheses"],
	},
};

export function parseReport(args: Record<string, unknown>): Report {
	const summary = str(args.summary);
	const rc = str(args.rootCause).trim();
	const hypotheses = asArray(args.hypotheses).map(normHypothesis);
	hypotheses.sort((a, b) => a.rank - b.rank);
	hypotheses.forEach((h, i) => {
		h.rank = i + 1; // normalize to a clean 1..n after sorting
	});
	return {
		summary,
		rootCause: rc || null,
		hypotheses,
		recommendations: asArray(args.recommendations).map(normRec),
	};
}

function normHypothesis(raw: unknown): Hypothesis {
	const o = obj(raw);
	const rank = typeof o.rank === "number" && Number.isFinite(o.rank) ? o.rank : 999;
	return { rank, statement: str(o.statement), evidence: asArray(o.evidence).map(normEvidence) };
}

function normEvidence(raw: unknown): Evidence {
	const o = obj(raw);
	const direction: EvidenceDirection = o.direction === "contradicts" ? "contradicts" : "supports";
	const status: EvidenceStatus = o.status === "verified" ? "verified" : "inferred";
	return { observation: str(o.observation), source: str(o.source), direction, status };
}

function normRec(raw: unknown): Recommendation {
	const o = obj(raw);
	return { title: str(o.title), detail: str(o.detail) };
}

function obj(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}
