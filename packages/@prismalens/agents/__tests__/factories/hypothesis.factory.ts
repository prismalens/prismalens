/**
 * Hypothesis Factory
 *
 * Factory functions for creating test hypotheses with realistic data.
 */

import { faker } from "@faker-js/faker";
import type { Hypothesis } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

type RootCauseCategory = "code" | "config" | "infrastructure" | "external" | "unknown";

export interface HypothesisOptions {
	claim?: string;
	confidence?: number;
	evidence?: string[];
	category?: RootCauseCategory;
	timestamp?: string;
}

// =============================================================================
// BASE FACTORY
// =============================================================================

/**
 * Create a single hypothesis with default or custom values
 */
export function createHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return {
		claim: options.claim ?? faker.lorem.sentence({ min: 6, max: 12 }),
		confidence: options.confidence ?? faker.number.int({ min: 50, max: 95 }),
		evidence: options.evidence ?? [
			faker.lorem.sentence(),
			faker.lorem.sentence(),
		],
		category: options.category ?? faker.helpers.arrayElement([
			"code",
			"config",
			"infrastructure",
			"external",
			"unknown",
		]),
		timestamp: options.timestamp ?? new Date().toISOString(),
	};
}

/**
 * Create multiple hypotheses
 */
export function createHypotheses(count: number, options: HypothesisOptions = {}): Hypothesis[] {
	return Array.from({ length: count }, () => createHypothesis(options));
}

// =============================================================================
// CONFIDENCE LEVEL FACTORIES
// =============================================================================

/**
 * Create a high-confidence hypothesis (90-100)
 */
export function createHighConfidenceHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		confidence: faker.number.int({ min: 90, max: 100 }),
		evidence: options.evidence ?? [
			"Direct stack trace shows error origin",
			"Code change in recent commit matches error location",
			"Reproduction confirmed in development environment",
		],
		...options,
	});
}

/**
 * Create a medium-confidence hypothesis (70-89)
 */
export function createMediumConfidenceHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		confidence: faker.number.int({ min: 70, max: 89 }),
		evidence: options.evidence ?? [
			"Timing correlation between deployment and error onset",
			"Similar error pattern seen in related code",
		],
		...options,
	});
}

/**
 * Create a low-confidence hypothesis (50-69)
 */
export function createLowConfidenceHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		confidence: faker.number.int({ min: 50, max: 69 }),
		evidence: options.evidence ?? [
			"Possible correlation observed but not confirmed",
		],
		...options,
	});
}

/**
 * Create a speculative hypothesis (<50)
 */
export function createSpeculativeHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		confidence: faker.number.int({ min: 10, max: 49 }),
		evidence: options.evidence ?? [
			"Speculation based on limited data",
		],
		...options,
	});
}

// =============================================================================
// CATEGORY-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create a code bug hypothesis
 */
export function createCodeBugHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		claim: options.claim ?? "Null pointer exception in authentication handler due to missing null check",
		category: "code",
		evidence: options.evidence ?? [
			"Stack trace points to auth-handler.ts line 42",
			"Variable 'user' can be null when session expires",
			"Similar bug fixed in PR #234 last month",
		],
		...options,
	});
}

/**
 * Create a configuration issue hypothesis
 */
export function createConfigHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		claim: options.claim ?? "Missing environment variable DATABASE_URL preventing database connection",
		category: "config",
		evidence: options.evidence ?? [
			"Logs show 'DATABASE_URL is not defined' error",
			"Recent deployment changed environment configuration",
			"Manual verification shows missing variable in production",
		],
		...options,
	});
}

/**
 * Create an infrastructure hypothesis
 */
export function createInfrastructureHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		claim: options.claim ?? "Container memory exhaustion causing OOMKilled errors",
		category: "infrastructure",
		evidence: options.evidence ?? [
			"Container metrics show 95% memory utilization",
			"OOMKilled events visible in orchestrator logs",
			"Memory leak pattern observed over past 24 hours",
		],
		...options,
	});
}

/**
 * Create an external dependency hypothesis
 */
export function createExternalHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		claim: options.claim ?? "Stripe API outage causing payment processing failures",
		category: "external",
		evidence: options.evidence ?? [
			"Stripe status page shows degraded service",
			"All payment-related endpoints timing out",
			"No changes in our payment code recently",
		],
		...options,
	});
}

/**
 * Create an unknown category hypothesis
 */
export function createUnknownCategoryHypothesis(options: HypothesisOptions = {}): Hypothesis {
	return createHypothesis({
		claim: options.claim ?? "Intermittent failures with unclear origin requiring further investigation",
		category: "unknown",
		confidence: options.confidence ?? faker.number.int({ min: 30, max: 55 }),
		evidence: options.evidence ?? [
			"Errors appear randomly without clear pattern",
			"No recent code changes in affected area",
			"Infrastructure metrics appear normal",
		],
		...options,
	});
}

// =============================================================================
// SCENARIO FACTORIES
// =============================================================================

/**
 * Create hypotheses for a typical investigation
 * Returns multiple hypotheses with varying confidence levels
 */
export function createInvestigationHypotheses(): Hypothesis[] {
	return [
		createHighConfidenceHypothesis({
			claim: "Primary hypothesis: Null pointer in auth handler",
			category: "code",
		}),
		createLowConfidenceHypothesis({
			claim: "Alternative hypothesis: Rate limiting misconfiguration",
			category: "config",
		}),
	];
}

/**
 * Create competing hypotheses for complex scenarios
 */
export function createCompetingHypotheses(
	primary: HypothesisOptions,
	alternatives: HypothesisOptions[],
): Hypothesis[] {
	return [
		createHypothesis({
			confidence: 85,
			...primary,
		}),
		...alternatives.map((alt, i) =>
			createHypothesis({
				confidence: 65 - i * 10,
				...alt,
			})
		),
	];
}
