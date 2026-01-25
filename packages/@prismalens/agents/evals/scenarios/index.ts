/**
 * Test Scenarios Index
 *
 * Exports all evaluation scenarios organized by category.
 */

// =============================================================================
// RE-EXPORTS
// =============================================================================

export * from "./types.js";
export * from "./code-bugs.scenarios.js";
export * from "./config-issues.scenarios.js";
export * from "./infrastructure.scenarios.js";

// =============================================================================
// COMBINED EXPORTS
// =============================================================================

import {
	codeBugScenarios,
	easyCodeBugScenarios,
	mediumCodeBugScenarios,
	hardCodeBugScenarios,
} from "./code-bugs.scenarios.js";

import {
	configIssueScenarios,
	easyConfigScenarios,
	mediumConfigScenarios,
	hardConfigScenarios,
} from "./config-issues.scenarios.js";

import {
	infrastructureScenarios,
	easyInfraScenarios,
	mediumInfraScenarios,
	hardInfraScenarios,
} from "./infrastructure.scenarios.js";

import type { ScenarioDefinition } from "../fixtures/incidents.js";

/**
 * All scenarios across all categories.
 */
export const allScenarios: ScenarioDefinition[] = [
	...codeBugScenarios,
	...configIssueScenarios,
	...infrastructureScenarios,
];

/**
 * Scenarios grouped by difficulty.
 */
export const scenariosByDifficulty = {
	easy: [...easyCodeBugScenarios, ...easyConfigScenarios, ...easyInfraScenarios],
	medium: [...mediumCodeBugScenarios, ...mediumConfigScenarios, ...mediumInfraScenarios],
	hard: [...hardCodeBugScenarios, ...hardConfigScenarios, ...hardInfraScenarios],
};

/**
 * Scenarios grouped by category.
 */
export const scenariosByCategory = {
	code: codeBugScenarios,
	config: configIssueScenarios,
	infrastructure: infrastructureScenarios,
};

/**
 * Get scenarios for quick smoke tests.
 * One easy scenario from each category.
 */
export function getSmokeTestScenarios(): ScenarioDefinition[] {
	return [
		easyCodeBugScenarios[0],
		easyConfigScenarios[0],
		easyInfraScenarios[0],
	].filter(Boolean) as ScenarioDefinition[];
}

/**
 * Get scenarios for thorough evaluation.
 * Mix of difficulties across all categories.
 */
export function getFullEvalScenarios(): ScenarioDefinition[] {
	return allScenarios;
}

/**
 * Get a random subset of scenarios for sampling.
 */
export function getRandomScenarios(
	count: number,
	difficulty?: "easy" | "medium" | "hard",
): ScenarioDefinition[] {
	const pool = difficulty ? scenariosByDifficulty[difficulty] : allScenarios;
	const shuffled = [...pool].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, Math.min(count, shuffled.length));
}
