/**
 * Test Scenario Types with Mock Definitions
 *
 * Extends the base ScenarioDefinition to include mock responses for GitHub and Render.
 * Each scenario is self-contained with its own mock data, ensuring controlled and
 * repeatable testing of agent behavior.
 *
 * @see TESTING_PLAN.md for design rationale
 */

import type { IntegrationMocks } from "../mocks/index.js";
import type { ScenarioDefinition } from "../fixtures/incidents.js";

// =============================================================================
// EXTENDED SCENARIO TYPES
// =============================================================================

/**
 * A test scenario with embedded mock responses.
 *
 * Each scenario defines:
 * 1. Input: The incident/alerts/integrations to investigate
 * 2. Mocks: The mock responses for GitHub and Render tools
 * 3. Expected: What the agent should conclude
 *
 * This approach ensures:
 * - Self-contained scenarios that don't depend on real APIs
 * - Realistic mock data that challenges the agent
 * - Repeatable tests with predictable outcomes
 *
 * @example
 * ```typescript
 * const scenario: ScenarioWithMocks = {
 *   ...baseScenario,
 *   mocks: {
 *     github: {
 *       searchCode: [{ file: "UserService.java", line: 42, snippet: "return user.getId();" }],
 *       listCommits: [{ sha: "abc123", message: "Remove null check", date: "2024-01-14" }],
 *     },
 *     render: {
 *       getLogs: [{ timestamp: "...", level: "error", message: "NPE at line 42" }],
 *     },
 *   },
 * };
 * ```
 */
export interface ScenarioWithMocks extends ScenarioDefinition {
	/**
	 * Mock responses for integration tools.
	 * Each scenario defines its own mock data, making tests self-contained.
	 */
	mocks: IntegrationMocks;

	/**
	 * Description of what the agent needs to do to solve this scenario.
	 * Helps document the expected reasoning path.
	 */
	solutionHint?: string;

	/**
	 * Tags for filtering scenarios (e.g., ["regression", "smoke", "edge-case"])
	 */
	tags?: string[];
}

// =============================================================================
// EXPECTED OUTPUT HELPERS
// =============================================================================

/**
 * Extended expected output with more granular checks.
 */
export interface ExtendedExpectedOutput {
	/** Investigation should complete successfully */
	status: "completed" | "failed";

	/** Minimum confidence level for root cause hypothesis */
	minConfidence: number;

	/** Expected root cause category */
	rootCauseCategory: "code" | "config" | "infrastructure" | "external" | "unknown";

	/** Should produce actionable recommendations */
	shouldHaveRecommendations: boolean;

	/** Keywords that should appear in root cause description */
	rootCauseKeywords?: string[];

	/** Expected tool calls (for trajectory evaluation) */
	expectedToolCalls?: string[];

	/** Tools that should NOT be called */
	forbiddenToolCalls?: string[];

	/** Minimum number of evidence pieces */
	minEvidence?: number;

	/** Expected recommendation types */
	expectedRecommendationTypes?: Array<"code_fix" | "config_change" | "rollback" | "monitoring" | "investigation">;

	// =========================================================================
	// ENHANCED TRAJECTORY VALIDATION FIELDS
	// =========================================================================

	/**
	 * Search terms the agent should search for during investigation.
	 * Used by evaluateSearchRelevance() to validate the agent searched
	 * for relevant information.
	 *
	 * @example ["NullPointerException", "UserService", "null check"]
	 */
	expectedSearchTerms?: string[];

	/**
	 * Files the agent should read during investigation.
	 * Used by evaluateFileRelevance() to validate the agent examined
	 * the correct source files.
	 *
	 * @example ["UserService.java", "UserController.java"]
	 */
	expectedFilesToRead?: string[];

	/**
	 * Regex patterns that should appear in tool arguments.
	 * Used by evaluateEvidenceCapture() to validate the agent
	 * captured relevant evidence patterns.
	 *
	 * @example ["line\\s*\\d+", "null.*check"]
	 */
	expectedEvidencePatterns?: string[];
}

// =============================================================================
// MOCK DATA QUALITY HELPERS
// =============================================================================

/**
 * Guidelines for creating realistic mock data.
 *
 * Mock data should be challenging enough to test real agent reasoning:
 * - NOT too obvious (no "THE BUG IS HERE" comments)
 * - Includes some noise (irrelevant files, old commits)
 * - Requires correlation across multiple sources
 * - Matches real-world patterns
 */
export interface MockDataQuality {
	/** Does the mock data require the agent to correlate multiple sources? */
	requiresCorrelation: boolean;

	/** Is there noise/irrelevant data mixed in? */
	hasNoise: boolean;

	/** Does the agent need to understand code context? */
	requiresCodeUnderstanding: boolean;

	/** Are there multiple plausible causes the agent must distinguish? */
	hasRedHerrings: boolean;
}

/**
 * Validate that mock data is sufficiently challenging.
 * Prints warnings for mocks that might be too easy.
 */
export function validateMockQuality(scenario: ScenarioWithMocks): MockDataQuality {
	const quality: MockDataQuality = {
		requiresCorrelation: false,
		hasNoise: false,
		requiresCodeUnderstanding: false,
		hasRedHerrings: false,
	};

	// Check if mock data spans multiple sources
	const hasMocks = scenario.mocks;
	const sourceCount =
		(hasMocks.github?.searchCode?.length ? 1 : 0) +
		(hasMocks.github?.getFile ? Object.keys(hasMocks.github.getFile).length : 0) +
		(hasMocks.github?.listCommits?.length ? 1 : 0) +
		(hasMocks.render?.getLogs?.length ? 1 : 0) +
		(hasMocks.render?.listServices?.length ? 1 : 0);

	quality.requiresCorrelation = sourceCount >= 2;

	// Check for noise (multiple results where only some are relevant)
	if (hasMocks.github?.searchCode && hasMocks.github.searchCode.length > 2) {
		quality.hasNoise = true;
	}
	if (hasMocks.github?.listCommits && hasMocks.github.listCommits.length > 3) {
		quality.hasNoise = true;
	}

	// Check if code understanding is required
	if (hasMocks.github?.getFile && Object.keys(hasMocks.github.getFile).length > 0) {
		quality.requiresCodeUnderstanding = true;
	}

	// Check for multiple plausible causes
	if (hasMocks.render?.getLogs) {
		const errorLogs = hasMocks.render.getLogs.filter((l) => l.level === "error");
		if (errorLogs.length > 1) {
			quality.hasRedHerrings = true;
		}
	}

	return quality;
}

// =============================================================================
// SCENARIO FILTERING
// =============================================================================

/**
 * Filter scenarios by difficulty level.
 */
export function filterByDifficulty(
	scenarios: ScenarioWithMocks[],
	difficulty: "easy" | "medium" | "hard",
): ScenarioWithMocks[] {
	return scenarios.filter((s) => s.difficulty === difficulty);
}

/**
 * Filter scenarios by category.
 */
export function filterByCategory(
	scenarios: ScenarioWithMocks[],
	category: "code" | "config" | "infrastructure" | "external" | "unknown",
): ScenarioWithMocks[] {
	return scenarios.filter((s) => s.category === category);
}

/**
 * Filter scenarios by tags.
 */
export function filterByTags(scenarios: ScenarioWithMocks[], tags: string[]): ScenarioWithMocks[] {
	return scenarios.filter((s) => s.tags && tags.some((t) => s.tags?.includes(t)));
}

/**
 * Get a subset of scenarios for smoke testing.
 * Returns one easy scenario from each category.
 */
export function getSmokeTestScenarios(scenarios: ScenarioWithMocks[]): ScenarioWithMocks[] {
	const byCategory = new Map<string, ScenarioWithMocks>();

	for (const scenario of scenarios) {
		if (scenario.difficulty === "easy" && !byCategory.has(scenario.category)) {
			byCategory.set(scenario.category, scenario);
		}
	}

	return Array.from(byCategory.values());
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a scenario has mocks defined.
 */
export function hasMocks(scenario: ScenarioDefinition): scenario is ScenarioWithMocks {
	return "mocks" in scenario && scenario.mocks !== undefined;
}

/**
 * Check if a scenario has GitHub mocks.
 */
export function hasGitHubMocks(scenario: ScenarioWithMocks): boolean {
	return scenario.mocks.github !== undefined;
}

/**
 * Check if a scenario has Render mocks.
 */
export function hasRenderMocks(scenario: ScenarioWithMocks): boolean {
	return scenario.mocks.render !== undefined;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { IntegrationMocks } from "../mocks/index.js";
