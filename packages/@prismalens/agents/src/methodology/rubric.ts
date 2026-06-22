/**
 * `pl-methodology` rubric — the SINGLE inject+grade source (work-unit 004,
 * FR-8/9/10, D0.3).
 *
 * Re-authored (NOT imported) from the retired engine skill
 * `prismalens-agents/skills/pl-methodology/SKILL.md` (+ its
 * `references/pl-commands.md`) per Principle I. The harvest keeps the *ideas*
 * — phased discipline, correlation strategies, contradiction/alert-storm
 * handling, stopping conditions — and STRIPS the engine coupling:
 *   - every retired-CLI invocation (the report/dispatch/status verbs) is gone
 *     (SC-3: no CLI command strings survive);
 *   - the retired role taxonomy (the gather/analyse/verify/resolve role names)
 *     is gone (SC-3), replaced by capability tags (`readonly | propose |
 *     mutate`, ADR 0002 §4 / Principle IV) plus named profiles;
 *   - the engine's "budget below 5%" stopping rule is DROPPED — budget belongs
 *     to 001/002 config, not the rubric (FR-10).
 *
 * D0.3: one structured source. `DEFAULT_METHODOLOGY_RUBRIC` is the canonical
 * data; `renderMethodologyPrompt` projects it to an injectable prose body and
 * `gradeReport` grades a returned report against the same structure — the prose
 * and the checklist can never diverge.
 *
 * The band is the sole accept/reject authority — this module imports
 * `classifyConfidence` / `requiresCorroboration` / `corroborationSatisfied`
 * from `./confidence.js` and NEVER hand-writes a threshold literal (SC-2).
 */

import {
	classifyConfidence,
	corroborationSatisfied,
	requiresCorroboration,
} from "./confidence.js";
import type { ConvergenceSignal } from "./convergence.js";
import type { Finding } from "./findings.js";
import type { InvestigationReport } from "./report.js";

/**
 * The five investigation phases, in dispatch order. Backend-neutral: the same
 * discipline steers a thin-loop (Ollama) run and an orchestrator-delegate
 * (Claude Code/Codex) run alike (Principle II).
 */
export type PhaseId =
	| "gather"
	| "correlate"
	| "hypothesize"
	| "validate"
	| "report";

/**
 * One machine-checkable criterion within a phase. `id` is stable so a
 * `GradeGap` / `GradeEvent` can name exactly which check failed.
 */
export interface PhaseCriterion {
	/** Stable criterion key (e.g. `"evidence-linked"`). */
	id: string;
	/** What this criterion asserts about the returned report. */
	description: string;
}

/** A phase of the methodology: ordered intent plus its gradeable criteria. */
export interface MethodologyPhase {
	id: PhaseId;
	/** One-line statement of the phase's job. */
	intent: string;
	/** Backend-neutral guidance rendered into the injectable prompt. */
	guidance: string[];
	/** The gradeable criteria this phase contributes to the rubric. */
	criteria: PhaseCriterion[];
}

/**
 * A correlation strategy — re-authored from the engine skill's correlation
 * table (label matching / time window / dependency chain / deploy).
 */
export interface CorrelationStrategy {
	/** Stable strategy key. */
	id: "label" | "time-window" | "dependency-chain" | "deploy";
	/** Human-readable name. */
	name: string;
	/** How to apply it. */
	how: string;
	/** A concrete, vendor-neutral illustration. */
	example: string;
}

/** Stopping-condition keys, reconciled to the band (FR-10). */
export type StoppingConditionId =
	| "auto-confidence"
	| "corroborated"
	| "criteria-resolved"
	| "no-new-info"
	| "timeout";

/**
 * One stopping condition: the situation that ends investigation and what the
 * platform does with it. `action` is `"report"` (synthesize & emit),
 * `"converge-report"` (negative `converged` signal then report with available
 * findings), or `"terminate"` (the ONLY hard stop — explicit timeout, never a
 * stall-kill; Principle III).
 */
export interface StoppingCondition {
	id: StoppingConditionId;
	/** When this condition is met. */
	condition: string;
	/** What the platform does when it is met. */
	action: "report" | "converge-report" | "terminate";
}

/**
 * The full structured methodology. Single source for both the injectable
 * prompt (FR-9a) and the grading rubric (FR-9b) — D0.3.
 */
export interface MethodologyRubric {
	phases: MethodologyPhase[];
	correlationStrategies: CorrelationStrategy[];
	/** How to handle contradictory findings (re-authored, FR-8). */
	contradictionRule: string;
	/** How to handle an alert storm (re-authored, FR-8). */
	alertStormRule: string;
	stoppingConditions: StoppingCondition[];
}

/**
 * FR-10 stopping conditions, keyed to the confidence band and stripped of the
 * engine's budget-percent rule. Exported so 002's loop and the rubric agree on
 * exactly one set. `no-new-info` converges-and-reports (a negative `converged`
 * signal, then report with available findings); only `timeout` terminates.
 */
export const STOPPING_CONDITIONS: StoppingCondition[] = [
	{
		id: "auto-confidence",
		condition:
			"Root-cause confidence lands in the auto band (classifyConfidence === 'auto').",
		action: "report",
	},
	{
		id: "corroborated",
		condition:
			"Confidence sits in the corroborate band AND ≥2 independent sources corroborate the leading hypothesis (corroborationSatisfied).",
		action: "report",
	},
	{
		id: "criteria-resolved",
		condition:
			"Every phase criterion is satisfied and no coverage gap remains open.",
		action: "report",
	},
	{
		id: "no-new-info",
		condition:
			"maxNoNewInfoRounds elapse with no new information (no added finding, no hypothesis status/confidence change, no closed coverage gap).",
		action: "converge-report",
	},
	{
		id: "timeout",
		condition:
			"The explicit wall-clock timeout (ConvergenceConfig.timeoutMs) is exceeded.",
		action: "terminate",
	},
];

/**
 * The re-authored, backend-neutral methodology content. This is the canonical
 * data; the prompt and the grade derive from it (D0.3). Contains no
 * retired-CLI command strings and no retired role-name strings (SC-3);
 * dispatch is expressed via capability tags + named profiles.
 */
export const DEFAULT_METHODOLOGY_RUBRIC: MethodologyRubric = {
	phases: [
		{
			id: "gather",
			intent:
				"Collect raw signals from every connected source before forming conclusions.",
			guidance: [
				"Read the investigation context to understand what triggered the run.",
				"Enumerate the connected integrations and their named readonly profiles (e.g. metrics, errors, dashboards, alerts).",
				"Dispatch readonly-capability profiles in parallel to query each source for signals within ±30 minutes of the trigger.",
				"Record each datum as its own observation finding with a source attribution the moment it is found — never batch.",
			],
			criteria: [
				{
					id: "sources-queried",
					description:
						"At least one source was actually queried and recorded in coverage.sourcesQueried.",
				},
				{
					id: "findings-attributed",
					description:
						"Gathered findings carry a source attribution so corroboration independence is computable.",
				},
			],
		},
		{
			id: "correlate",
			intent: "Connect signals across sources to surface patterns.",
			guidance: [
				"Match on shared labels (service / namespace / dependency) across sources.",
				"Align events inside a ±30-minute window around the trigger.",
				"Walk the dependency chain upstream/downstream of the affected service.",
				"Check recent deploys to the affected service against the onset time.",
			],
			criteria: [
				{
					id: "coverage-recorded",
					description:
						"Coverage records what was queried and which gaps remain, so correlation breadth is auditable.",
				},
			],
		},
		{
			id: "hypothesize",
			intent: "Form specific, testable hypotheses from correlated data.",
			guidance: [
				"State each hypothesis concretely and reference the concrete evidence it rests on.",
				"Give every hypothesis a test plan: what evidence would confirm or refute it.",
				"Avoid vague hypotheses ('something is wrong with the database'); name the mechanism.",
			],
			criteria: [
				{
					id: "hypotheses-evidence-linked",
					description:
						"Every hypothesis links at least one supporting finding (no free-floating claims).",
				},
			],
		},
		{
			id: "validate",
			intent:
				"Test each hypothesis with targeted evidence and weigh what argues against it.",
			guidance: [
				"Dispatch focused readonly profiles, one per hypothesis, to gather confirming or refuting evidence.",
				"Link each new finding to the hypothesis it bears on via relatedTo.",
				"Record contradicting evidence explicitly — a hypothesis with no considered counter-evidence is unvalidated.",
				"If confidence sits in the corroborate band, secure ≥2 independent sources before treating it as a conclusion.",
			],
			criteria: [
				{
					id: "contradiction-considered",
					description:
						"Each non-refuted hypothesis has either contradicting evidence recorded or is supported strongly enough that none was found — contradictions are not ignored.",
				},
				{
					id: "corroboration-satisfied",
					description:
						"Any hypothesis whose confidence requires corroboration is backed by ≥2 independent sources; otherwise it is a coverage gap, not a conclusion.",
				},
			],
		},
		{
			id: "report",
			intent:
				"Synthesize validated findings into an evidence-linked root-cause report.",
			guidance: [
				"State the root cause, its category, and a confidence the band can classify.",
				"Link the root cause and every recommendation back to supporting findings — an un-evidenced conclusion is rubric-invalid.",
				"Record what was ruled out and why, and the coverage achieved, as part of the audit trail.",
			],
			criteria: [
				{
					id: "conclusion-evidence-linked",
					description:
						"Any stated root cause and every root_cause/recommendation finding links at least one supporting finding (NFR-2 / Principle IX).",
				},
			],
		},
	],
	correlationStrategies: [
		{
			id: "label",
			name: "Label matching",
			how: "Match the same service/namespace/dependency label across sources.",
			example:
				"alerts profile shows service=payment-api firing AND errors profile shows project=payment-api spiking.",
		},
		{
			id: "time-window",
			name: "Time window",
			how: "Treat events inside ±30 minutes of the trigger as candidates for correlation.",
			example: "An out-of-memory event at 10:20 alongside a deploy at 10:15.",
		},
		{
			id: "dependency-chain",
			name: "Dependency chain",
			how: "Follow upstream/downstream dependencies of the affected service.",
			example:
				"payment-api depends on postgres → inspect postgres signals next.",
		},
		{
			id: "deploy",
			name: "Deploy correlation",
			how: "Line up recent deploys to the affected service against symptom onset.",
			example:
				"Deploy v2.3.1 at 10:15 immediately preceding an error spike at 10:20.",
		},
	],
	contradictionRule:
		"When findings contradict, do not ignore the discrepancy. Dispatch a focused readonly profile to investigate it directly — the resolution often reveals the actual root cause. Record the contradicting evidence against the affected hypothesis (wrong service label? different time window? different error classification?).",
	alertStormRule:
		"When more than 10 alerts fire within 60 seconds, do not open a task per alert. Find the labels shared across the storm (common service, namespace, or dependency), identify the upstream cause, and run a single investigation against the shared dependency rather than each downstream symptom. Treat flapping (>3 fire/resolve cycles in 30 minutes) as one intermittent issue; a self-healing alert that resolves mid-investigation still needs a root cause — the resolution timing is itself evidence.",
	stoppingConditions: STOPPING_CONDITIONS,
};

/**
 * A single rubric gap — a named criterion that failed, optionally scoped to a
 * phase, with a human-readable detail that doubles as re-dispatch feedback.
 */
export type GradeGap = { criterion: string; phase?: string; detail: string };

/**
 * The outcome of grading a report at the boundary. `pass` is true iff there
 * are no gaps; `score` is the fraction of evaluated checks that passed;
 * `signal` is a NEGATIVE `ConvergenceSignal` whenever there is a gap (never a
 * throw/kill — Principle III) and may be a `converged` signal or `null` on a
 * clean pass.
 */
export interface GradeResult {
	pass: boolean;
	score: number;
	gaps: GradeGap[];
	signal: ConvergenceSignal | null;
}

/**
 * Render the structured rubric (D0.3) into a backend-neutral, injectable
 * system-prompt / skill body — the inject half of FR-9. Consumable as a
 * thin-loop system prompt or an orchestrator skill bundle. By construction it
 * contains zero `pl ` CLI commands and zero role names (SC-3): dispatch is
 * described purely via capability tags and named profiles.
 *
 * @param rubric  the rubric to render (defaults to the canonical content).
 */
export function renderMethodologyPrompt(
	rubric: MethodologyRubric = DEFAULT_METHODOLOGY_RUBRIC,
): string {
	const lines: string[] = [];

	lines.push("# Investigation Methodology");
	lines.push("");
	lines.push(
		"Systematic incident investigation for any backend. Dispatch is by capability tag (readonly | propose | mutate) and named profile — gather and validate with readonly profiles; only escalate to propose/mutate when explicitly permitted. Investigation output is the trust surface: every conclusion must be linked to evidence.",
	);
	lines.push("");

	lines.push("## Phases");
	for (const [i, phase] of rubric.phases.entries()) {
		lines.push("");
		lines.push(`### Phase ${i + 1}: ${capitalize(phase.id)}`);
		lines.push("");
		lines.push(phase.intent);
		lines.push("");
		for (const g of phase.guidance) {
			lines.push(`- ${g}`);
		}
	}
	lines.push("");

	lines.push("## Correlation Strategies");
	lines.push("");
	for (const s of rubric.correlationStrategies) {
		lines.push(`- **${s.name}** — ${s.how} _Example:_ ${s.example}`);
	}
	lines.push("");

	lines.push("## Handling Contradictions");
	lines.push("");
	lines.push(rubric.contradictionRule);
	lines.push("");

	lines.push("## Alert Storm Handling");
	lines.push("");
	lines.push(rubric.alertStormRule);
	lines.push("");

	lines.push("## Stopping Conditions");
	lines.push("");
	lines.push("Stop investigating when ANY condition is met:");
	lines.push("");
	for (const c of rubric.stoppingConditions) {
		lines.push(`- ${c.condition} → **${c.action}**`);
	}

	return lines.join("\n");
}

/** Title-case a phase id for prompt headings. */
function capitalize(s: string): string {
	return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Does a finding type carry a conclusion that NFR-2 requires evidence for?
 * (`root_cause` and `recommendation` must link supporting findings.)
 */
function isConclusionType(type: Finding["type"]): boolean {
	return type === "root_cause" || type === "recommendation";
}

/**
 * Grade a returned report against the rubric — the grade half of FR-9
 * (Principle IX). Structural, deterministic, and NEVER throws or kills
 * (Principle III): any failure becomes a `GradeGap` plus a negative
 * `ConvergenceSignal`.
 *
 * Gaps (each contributes one failed check):
 *   - NFR-2: a stated `rootCause`, or any `root_cause`/`recommendation`
 *     finding, with no linked supporting finding → gap (SC-4).
 *   - A non-refuted hypothesis with no supporting evidence → gap.
 *   - A hypothesis with un-considered contradiction (status not `refuted`,
 *     no contradicting evidence, and not yet `supported`) → gap.
 *   - A hypothesis whose confidence `requiresCorroboration()` but is NOT
 *     `corroborationSatisfied()` → gap (FR-7).
 *   - Phase coverage (FR-9b): no source queried, an unattributed gathered
 *     finding, or empty coverage → gap — so every declared phase criterion is
 *     graded, not just rendered into the prompt (D0.3).
 *
 * @param report  the report to grade.
 * @param rubric  the rubric to grade against (defaults to the canonical content).
 */
export function gradeReport(
	report: InvestigationReport,
	rubric: MethodologyRubric = DEFAULT_METHODOLOGY_RUBRIC,
): GradeResult {
	const gaps: GradeGap[] = [];
	let checks = 0;

	// The phase a given criterion belongs to is read from the rubric so the
	// grade's gap `phase` labels stay in lock-step with the injected prompt
	// (D0.3: one source). Falls back to undefined if a criterion is absent.
	const phaseOf = (criterionId: string): PhaseId | undefined =>
		rubric.phases.find((p) => p.criteria.some((c) => c.id === criterionId))?.id;

	/** A finding backs `targetId` iff it points at it via `relatedTo`. */
	const hasSupportingFindingFor = (targetId: string): boolean =>
		report.findings.some((f) => f.relatedTo === targetId);

	// --- NFR-2 / SC-4: stated root cause must be evidence-linked. ---
	if (report.rootCause !== undefined && report.rootCause.length > 0) {
		checks += 1;
		const rootCauseFindings = report.findings.filter(
			(f) => f.type === "root_cause",
		);
		// A stated root cause is evidence-linked iff at least one `root_cause`
		// finding exists AND is itself backed by a supporting finding (relatedTo).
		// "Evidence exists somewhere in the report" is NOT enough — the link must
		// be TO the root cause (SC-4 / NFR-2); a bare `rootCause` string with no
		// supported root_cause finding is a gap.
		const hasEvidence =
			rootCauseFindings.length > 0 &&
			rootCauseFindings.some((rc) => hasSupportingFindingFor(rc.id));
		if (!hasEvidence) {
			gaps.push({
				criterion: "conclusion-evidence-linked",
				phase: phaseOf("conclusion-evidence-linked"),
				detail:
					"A root cause is stated but no supported root_cause finding links to it. An un-evidenced conclusion is rubric-invalid (NFR-2 / SC-4).",
			});
		}
	}

	// --- NFR-2: every conclusion-type finding must link a supporting finding. ---
	for (const f of report.findings) {
		if (!isConclusionType(f.type)) continue;
		checks += 1;
		if (!hasSupportingFindingFor(f.id)) {
			gaps.push({
				criterion: "conclusion-evidence-linked",
				phase: phaseOf("conclusion-evidence-linked"),
				detail: `${f.type} finding ${f.id} has no linked supporting finding (NFR-2): "${f.description}".`,
			});
		}
	}

	// --- Gather / correlate phase coverage (FR-9b: each phase covered; D0.3).
	// Every declared PhaseCriterion maps to a check here, so the injected prompt
	// and the grade can never advertise different criteria. ---

	// sources-queried (gather): at least one source was actually queried.
	checks += 1;
	if (report.coverage.sourcesQueried.length === 0) {
		gaps.push({
			criterion: "sources-queried",
			phase: phaseOf("sources-queried"),
			detail:
				"No source was queried (coverage.sourcesQueried is empty) — the gather phase produced no attributed signal.",
		});
	}

	// findings-attributed (gather): gathered findings carry a source so
	// corroboration independence is computable. Only graded when such findings
	// exist.
	const gathered = report.findings.filter(
		(f) => f.type === "observation" || f.type === "evidence",
	);
	if (gathered.length > 0) {
		checks += 1;
		const unattributed = gathered.filter((f) => !f.source);
		if (unattributed.length > 0) {
			gaps.push({
				criterion: "findings-attributed",
				phase: phaseOf("findings-attributed"),
				detail: `${unattributed.length} gathered finding(s) lack a source attribution; corroboration independence cannot be computed for them.`,
			});
		}
	}

	// coverage-recorded (correlate): coverage records what was queried and which
	// gaps remain, so correlation breadth is auditable.
	checks += 1;
	if (
		report.coverage.sourcesQueried.length === 0 &&
		report.coverage.dataGaps.length === 0
	) {
		gaps.push({
			criterion: "coverage-recorded",
			phase: phaseOf("coverage-recorded"),
			detail:
				"Coverage records neither queried sources nor data gaps — correlation breadth is not auditable.",
		});
	}

	// --- Per-hypothesis checks. ---
	for (const h of report.hypotheses) {
		// Evidence-linked: a live hypothesis needs supporting evidence.
		if (h.status !== "refuted") {
			checks += 1;
			if (h.supportingEvidence.length === 0) {
				gaps.push({
					criterion: "hypotheses-evidence-linked",
					phase: phaseOf("hypotheses-evidence-linked"),
					detail: `Hypothesis ${h.id} ("${h.statement}") has no supporting evidence.`,
				});
			}
		}

		// Contradiction considered: a hypothesis that is neither refuted nor
		// confirmed must have had its contradiction considered.
		if (h.status !== "refuted" && h.status !== "supported") {
			checks += 1;
			if (h.contradictingEvidence.length === 0) {
				gaps.push({
					criterion: "contradiction-considered",
					phase: phaseOf("contradiction-considered"),
					detail: `Hypothesis ${h.id} ("${h.statement}") records no contradicting evidence — its counter-evidence was not considered.`,
				});
			}
		}

		// Corroboration: a corroborate-band hypothesis needs ≥2 independent sources.
		if (h.status !== "refuted" && requiresCorroboration(h.confidence)) {
			checks += 1;
			if (!corroborationSatisfied(h, report.findings)) {
				gaps.push({
					criterion: "corroboration-satisfied",
					phase: phaseOf("corroboration-satisfied"),
					detail: `Hypothesis ${h.id} sits in the corroborate band but lacks ≥2 independent corroborating sources — a coverage gap, not a conclusion (FR-7).`,
				});
			}
		}
	}

	const pass = gaps.length === 0;
	// Score = fraction of evaluated checks that passed. With no checks (an empty
	// report) the structure is trivially consistent → score 1.
	const score = checks === 0 ? 1 : (checks - gaps.length) / checks;

	let signal: ConvergenceSignal | null;
	if (!pass) {
		// ANY gap → a NEGATIVE signal (never a throw/kill — Principle III). A
		// gap means the report cannot stand as final; the band decides whether
		// the right framing is "stalled" (work remains and could resolve it) or
		// "converged" (in-band confidence yet still gappy — likely the ceiling
		// of available signal).
		const band = classifyConfidence(report.confidence);
		signal =
			band === "reject"
				? {
						type: "stalled",
						reason: `Report rejected on ${gaps.length} rubric gap(s); below the corroborate band — re-dispatch with feedback.`,
					}
				: {
						type: "converged",
						reason: `Report has ${gaps.length} rubric gap(s) despite in-band confidence; converge and surface the gaps as feedback.`,
					};
	} else {
		signal = null;
	}

	return { pass, score, gaps, signal };
}
