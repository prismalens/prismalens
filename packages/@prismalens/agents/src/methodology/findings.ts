/**
 * Investigation output currency — Finding & Hypothesis.
 *
 * Re-authored (NOT imported) from the retired `prismalens-agents` engine
 * (`src/types/findings.ts`) per work-unit 004 (FR-1, FR-2) and Principle I
 * (no upstream engine). This is the single shape every adapter emits —
 * thin-loop (Ollama) or orchestrator-delegate (Claude Code/Codex) alike
 * (Principle II) — so reports stay gradeable and evidence-linked (Principle IX).
 *
 * Net-new vs the product's legacy `types/results.ts` `Hypothesis`:
 *   - findings carry per-item `source` + `confidence` and a `relatedTo` graph;
 *   - evidence is referenced by `FindingId`, not embedded structs;
 *   - hypotheses carry `contradictingEvidence`, a lifecycle `status`, and `iteration`.
 */

declare const findingIdBrand: unique symbol;

/**
 * Branded finding identifier. A `Finding.id`, and the only thing a
 * `relatedTo` / `supportingEvidence` / `contradictingEvidence` reference may
 * hold — so the evidence graph cannot silently point at a free string.
 */
export type FindingId = string & { readonly [findingIdBrand]: true };

/** Narrow a raw string (e.g. `'f-001'`) into a `FindingId`. */
export function asFindingId(id: string): FindingId {
	return id as FindingId;
}

/** What a finding represents. Harvested verbatim from the engine taxonomy. */
export type FindingType =
	| "hypothesis"
	| "evidence"
	| "observation"
	| "root_cause"
	| "recommendation"
	| "error"
	| "metadata";

/**
 * One atomic observation, datum, or claim produced during an investigation.
 *
 * NFR-2 (Principle IX): a `root_cause` / `recommendation` finding with no
 * supporting `relatedTo` link is rubric-invalid — see `gradeReport`.
 */
export interface Finding {
	/** Unique finding ID (e.g. `'f-001'`). */
	id: FindingId;

	/** Classification of what this finding represents. */
	type: FindingType;

	/** Human-readable description of the finding. */
	description: string;

	/** Confidence (0.0–1.0). Expected for `hypothesis` and `root_cause` types. */
	confidence?: number;

	/**
	 * Where this finding came from — an integration/source key
	 * (e.g. `'prometheus'`, `'sentry'`, `'grafana'`, `'alertmanager'`,
	 * `'github-commits'`). Drives corroboration independence (FR-7).
	 */
	source?: string;

	/** ID of the agent (profile/sub-agent) that produced this finding. */
	agentId: string;

	/** Another finding this one relates to (e.g. evidence backing a hypothesis). */
	relatedTo?: FindingId;

	/** Whether this finding represents a fatal/blocking error. */
	fatal?: boolean;

	/** When this finding was recorded (ISO 8601). */
	timestamp: string;
}

/** Lifecycle of a hypothesis as it is proposed, tested, and resolved. */
export type HypothesisStatus =
	| "proposed"
	| "testing"
	| "supported"
	| "refuted"
	| "inconclusive";

/**
 * A candidate explanation under investigation.
 *
 * `supportingEvidence` / `contradictingEvidence` are `FindingId` references
 * (not embedded structs), so the report is a graph the system of record
 * retains (Principle VI). `contradictingEvidence` is mandatory currency —
 * the legacy `results.ts` `Hypothesis` had no way to record what argues
 * *against* a cause, which is how confident-but-wrong RCAs shipped.
 */
export interface Hypothesis {
	/** Unique hypothesis ID (e.g. `'hyp-001'`). */
	id: string;

	/** Human-readable hypothesis statement. */
	statement: string;

	/** Current position in the hypothesis lifecycle. */
	status: HypothesisStatus;

	/** Confidence (0.0–1.0) — classified by the band, not a bare threshold. */
	confidence: number;

	/** IDs of findings that support this hypothesis. */
	supportingEvidence: FindingId[];

	/** IDs of findings that contradict this hypothesis. */
	contradictingEvidence: FindingId[];

	/** What evidence would confirm or refute this hypothesis. */
	testPlan?: string;

	/** Why this hypothesis was refuted (when `status === "refuted"`). */
	refutationReason?: string;

	/** Which investigation iteration created/last-updated this hypothesis. */
	iteration: number;
}
