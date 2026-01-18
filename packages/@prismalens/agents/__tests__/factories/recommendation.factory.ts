/**
 * Recommendation Factory
 *
 * Factory functions for creating test recommendations.
 */

import { faker } from "@faker-js/faker";
import type { Recommendation, CodeChange } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

type Priority = "critical" | "high" | "medium" | "low";
type Category = "code_fix" | "config_change" | "rollback" | "monitoring" | "investigation";
type Urgency = "immediate" | "short_term" | "long_term";
type Effort = "minutes" | "hours" | "days";

export interface RecommendationOptions {
	title?: string;
	description?: string;
	priority?: Priority;
	category?: Category;
	urgency?: Urgency;
	actionable?: boolean;
	estimatedEffort?: Effort;
	codeChanges?: CodeChange[];
}

export interface CodeChangeOptions {
	filePath?: string;
	searchBlock?: string;
	replaceBlock?: string;
	testCase?: string;
}

// =============================================================================
// CODE CHANGE FACTORY
// =============================================================================

/**
 * Create a code change
 */
export function createCodeChange(options: CodeChangeOptions = {}): CodeChange {
	return {
		filePath: options.filePath ?? "src/services/auth-handler.ts",
		searchBlock: options.searchBlock ?? `return user.id.toString();`,
		replaceBlock: options.replaceBlock ?? `if (!user) {
  throw new Error('User is required');
}
return user.id.toString();`,
		testCase: options.testCase ?? "Run `npm test -- auth-handler.test.ts` and verify all tests pass",
	};
}

/**
 * Create multiple code changes
 */
export function createCodeChanges(count: number, baseOptions: CodeChangeOptions = {}): CodeChange[] {
	return Array.from({ length: count }, (_, i) =>
		createCodeChange({
			...baseOptions,
			filePath: baseOptions.filePath ?? `src/services/handler-${i}.ts`,
		})
	);
}

// =============================================================================
// BASE RECOMMENDATION FACTORY
// =============================================================================

/**
 * Create a recommendation with default or custom values
 */
export function createRecommendation(options: RecommendationOptions = {}): Recommendation {
	return {
		title: options.title ?? faker.lorem.sentence({ min: 3, max: 8 }),
		description: options.description ?? faker.lorem.paragraph(),
		priority: options.priority ?? faker.helpers.arrayElement(["critical", "high", "medium", "low"]),
		category: options.category ?? faker.helpers.arrayElement([
			"code_fix",
			"config_change",
			"rollback",
			"monitoring",
			"investigation",
		]),
		urgency: options.urgency ?? faker.helpers.arrayElement(["immediate", "short_term", "long_term"]),
		actionable: options.actionable ?? true,
		estimatedEffort: options.estimatedEffort ?? faker.helpers.arrayElement(["minutes", "hours", "days"]),
		codeChanges: options.codeChanges,
	};
}

/**
 * Create multiple recommendations
 */
export function createRecommendations(count: number, options: RecommendationOptions = {}): Recommendation[] {
	return Array.from({ length: count }, () => createRecommendation(options));
}

// =============================================================================
// CATEGORY-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create a code fix recommendation
 */
export function createCodeFixRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		title: options.title ?? "Fix null pointer in auth handler",
		description: options.description ?? "Add null check before accessing user properties to prevent NullPointerException",
		category: "code_fix",
		priority: options.priority ?? "high",
		urgency: options.urgency ?? "immediate",
		estimatedEffort: options.estimatedEffort ?? "minutes",
		codeChanges: options.codeChanges ?? [createCodeChange()],
		...options,
	});
}

/**
 * Create a config change recommendation
 */
export function createConfigChangeRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		title: options.title ?? "Update environment configuration",
		description: options.description ?? "Set the missing DATABASE_URL environment variable",
		category: "config_change",
		priority: options.priority ?? "high",
		urgency: options.urgency ?? "immediate",
		estimatedEffort: options.estimatedEffort ?? "minutes",
		...options,
	});
}

/**
 * Create a rollback recommendation
 */
export function createRollbackRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		title: options.title ?? "Rollback to previous deployment",
		description: options.description ?? "Revert to the last known working deployment to restore service stability",
		category: "rollback",
		priority: options.priority ?? "critical",
		urgency: "immediate",
		estimatedEffort: "minutes",
		...options,
	});
}

/**
 * Create a monitoring recommendation
 */
export function createMonitoringRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		title: options.title ?? "Add alerting for similar errors",
		description: options.description ?? "Set up alerts to catch similar null pointer exceptions before they impact users",
		category: "monitoring",
		priority: options.priority ?? "medium",
		urgency: "short_term",
		estimatedEffort: "hours",
		...options,
	});
}

/**
 * Create an investigation recommendation
 */
export function createInvestigationRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		title: options.title ?? "Further investigation needed",
		description: options.description ?? "Insufficient evidence to determine root cause. Additional log analysis recommended.",
		category: "investigation",
		priority: options.priority ?? "medium",
		urgency: "short_term",
		actionable: false,
		estimatedEffort: "hours",
		...options,
	});
}

// =============================================================================
// PRIORITY-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create a critical priority recommendation
 */
export function createCriticalRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		priority: "critical",
		urgency: "immediate",
		...options,
	});
}

/**
 * Create a low priority recommendation
 */
export function createLowPriorityRecommendation(options: RecommendationOptions = {}): Recommendation {
	return createRecommendation({
		priority: "low",
		urgency: "long_term",
		estimatedEffort: "days",
		...options,
	});
}

// =============================================================================
// SCENARIO FACTORIES
// =============================================================================

/**
 * Create recommendations for a code bug scenario
 */
export function createCodeBugScenarioRecommendations(): Recommendation[] {
	return [
		createCodeFixRecommendation({
			title: "Add null check in auth handler",
			codeChanges: [
				createCodeChange({
					filePath: "src/services/auth-handler.ts",
					searchBlock: `export function handleAuth(user: User) {
  return user.id.toString();
}`,
					replaceBlock: `export function handleAuth(user: User) {
  if (!user) {
    throw new Error('User is required');
  }
  return user.id.toString();
}`,
				}),
			],
		}),
		createMonitoringRecommendation({
			title: "Add null check validation in tests",
		}),
	];
}

/**
 * Create recommendations for a deployment regression
 */
export function createDeploymentRegressionRecommendations(): Recommendation[] {
	return [
		createRollbackRecommendation(),
		createCodeFixRecommendation({
			title: "Fix regression in latest commit",
			priority: "high",
			urgency: "short_term",
		}),
	];
}

/**
 * Create recommendations when investigation is inconclusive
 */
export function createInconclusiveInvestigationRecommendations(): Recommendation[] {
	return [
		createInvestigationRecommendation({
			title: "Collect additional metrics",
			description: "Enable detailed tracing to capture more context on intermittent failures",
		}),
		createMonitoringRecommendation({
			title: "Set up correlation alerts",
			description: "Configure alerts to correlate multiple error signals",
		}),
	];
}
