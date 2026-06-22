/**
 * methodology — harvested investigation discipline & output currency
 * (work-unit 004).
 *
 * Single barrel for the re-authored (NOT imported — Principle I / NFR-1)
 * artifacts work-unit 002 consumes: the `Finding` / `Hypothesis` /
 * `InvestigationReport` output currency, the one confidence band, the
 * `pl-methodology` inject+grade rubric, the convergence + seed-call contracts,
 * the methodology event payloads, and the profile-seed catalog.
 *
 * 002 imports investigation output, the band, and the rubric ONLY from here
 * (SC-1). Re-exports are grouped by source file and mirror the package barrel
 * style (`src/index.ts`): types via `export type`, values/functions via
 * `export`.
 */

// =============================================================================
// Findings — output currency (FR-1, FR-2)
// =============================================================================

export type {
	Finding,
	FindingId,
	FindingType,
	Hypothesis,
	HypothesisStatus,
} from "./findings.js";
export { asFindingId } from "./findings.js";

// =============================================================================
// Confidence band — sole accept/reject authority (FR-5, FR-6, FR-7)
// =============================================================================

export type { ConfidenceBand } from "./confidence.js";
export {
	CONFIDENCE_BAND,
	classifyConfidence,
	corroboratingSourceCount,
	corroborationSatisfied,
	requiresCorroboration,
} from "./confidence.js";

// =============================================================================
// Report — graded final shape (FR-3, FR-4)
// =============================================================================

export type {
	Coverage,
	InvestigationReport,
	RuledOut,
} from "./report.js";
export { deriveBand } from "./report.js";

// =============================================================================
// Convergence — contract only; 002 implements the loop (FR-11, FR-12)
// =============================================================================

export type {
	ConvergenceConfig,
	ConvergenceSignal,
	ProgressSnapshot,
} from "./convergence.js";
export {
	buildSnapshot,
	DEFAULT_CONVERGENCE_CONFIG,
	isNewInformation,
} from "./convergence.js";

// =============================================================================
// Seed calls — contract only; 002 executes pre-loop (FR-13)
// =============================================================================

export type {
	ProfileSeedHint,
	SeedCall,
	SeedPlan,
	SeedResult,
} from "./seed.js";
export { planSeed } from "./seed.js";

// =============================================================================
// Methodology events — negative-signal payloads (plan "Observability")
// =============================================================================

export type {
	ConvergedEvent,
	GradeEvent,
	MethodologyEvent,
	StalledEvent,
} from "./events.js";

// =============================================================================
// Rubric — single inject+grade source (FR-8, FR-9, FR-10)
// =============================================================================

export type {
	CorrelationStrategy,
	GradeGap,
	GradeResult,
	MethodologyPhase,
	MethodologyRubric,
	PhaseCriterion,
	PhaseId,
	StoppingCondition,
	StoppingConditionId,
} from "./rubric.js";
export {
	DEFAULT_METHODOLOGY_RUBRIC,
	gradeReport,
	renderMethodologyPrompt,
	STOPPING_CONDITIONS,
} from "./rubric.js";

// =============================================================================
// Profile-seed catalog — data for 002 (FR-14, FR-15)
// =============================================================================

export type {
	CapabilityTag,
	ProfileSeed,
} from "./profiles.js";
export { PROFILE_SEEDS } from "./profiles.js";
