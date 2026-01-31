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
export * from "./with-clone.scenarios.js";

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

import {
	cloneScenarios,
	easyCloneScenarios,
	mediumCloneScenarios,
	hardCloneScenarios,
} from "./with-clone.scenarios.js";

import type { ScenarioDefinition } from "../fixtures/incidents.js";

/**
 * All scenarios across all categories (excluding clone scenarios).
 * Clone scenarios require special setup (clonePaths) and are exported separately.
 */
export const allScenarios: ScenarioDefinition[] = [
	...codeBugScenarios,
	...configIssueScenarios,
	...infrastructureScenarios,
];

/**
 * All scenarios including clone scenarios.
 * Clone scenarios have clonePaths and expect repo_* tools.
 */
export const allScenariosWithClone: ScenarioDefinition[] = [
	...allScenarios,
	...cloneScenarios,
];

/**
 * Scenarios grouped by difficulty (excluding clone scenarios).
 */
export const scenariosByDifficulty = {
	easy: [...easyCodeBugScenarios, ...easyConfigScenarios, ...easyInfraScenarios],
	medium: [...mediumCodeBugScenarios, ...mediumConfigScenarios, ...mediumInfraScenarios],
	hard: [...hardCodeBugScenarios, ...hardConfigScenarios, ...hardInfraScenarios],
};

/**
 * Clone scenarios grouped by difficulty.
 */
export const cloneScenariosByDifficulty = {
	easy: easyCloneScenarios,
	medium: mediumCloneScenarios,
	hard: hardCloneScenarios,
};

/**
 * Scenarios grouped by category.
 */
export const scenariosByCategory = {
	code: codeBugScenarios,
	config: configIssueScenarios,
	infrastructure: infrastructureScenarios,
	clone: cloneScenarios,
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
