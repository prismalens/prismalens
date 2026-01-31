/**
 * Change Scenario Presets for ChangeTracker Evaluations
 *
 * Pre-built scenarios that test different change-related incident patterns.
 * Each scenario provides mock data that ChangeTracker should analyze and
 * produce findings for.
 */

import type { RecentChangesContext } from "../../src/types/state.js";
import {
	createMockCommit,
	createMockConfigChange,
	createMockDeployment,
	createRiskyCommit,
} from "./pre-gathered.js";

// =============================================================================
// SCENARIO TYPES
// =============================================================================

export interface ChangeScenario {
	/** Unique name for the scenario */
	name: string;
	/** Description of what this scenario tests */
	description: string;
	/** The mock change data */
	recentChanges: RecentChangesContext;
	/** Expected findings from ChangeTracker */
	expectedFindings: {
		/** Minimum number of findings expected */
		minCount: number;
		/** Expected finding types */
		types: Array<"deployment" | "commit" | "config">;
		/** Expected minimum relevance score for the top finding */
		minRelevance: number;
	};
	/** Tags for filtering scenarios */
	tags: string[];
}

// =============================================================================
// SCENARIO PRESETS
// =============================================================================

/**
 * Scenario: Recent failed deployment
 *
 * A deployment failed 15 minutes before the incident. This is the most common
 * pattern (BigPanda: 60-90% of incidents are change-related).
 */
export const FAILED_DEPLOYMENT_SCENARIO: ChangeScenario = {
	name: "Failed Deployment",
	description: "A deployment failed 15 minutes before the incident, likely the root cause",
	recentChanges: {
		deployments: [
			createMockDeployment({
				id: "deploy-fail-001",
				service: "api-server",
				status: "failed",
				riskScore: 90,
				riskFactors: [
					"deployment failed",
					"health check failed",
					"deployed 15 minutes before incident",
				],
				timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
			}),
			createMockDeployment({
				id: "deploy-success-001",
				service: "api-server",
				status: "success",
				riskScore: 30,
				riskFactors: ["successful deployment", "deployed 4 hours ago"],
				timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
			}),
		],
		commits: [
			createMockCommit({
				message: "feat: add new API endpoint for user preferences",
				timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
			}),
			createMockCommit({
				message: "fix: update error handling in auth middleware",
				timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
			}),
		],
		configChanges: [],
	},
	expectedFindings: {
		minCount: 1,
		types: ["deployment"],
		minRelevance: 80,
	},
	tags: ["deployment", "high-confidence", "common"],
};

/**
 * Scenario: Config change caused incident
 *
 * A configuration change (database pool size) was made 30 minutes before
 * the incident, causing resource exhaustion.
 */
export const CONFIG_CHANGE_SCENARIO: ChangeScenario = {
	name: "Config Change Rollback",
	description: "Database pool size was reduced, causing connection exhaustion",
	recentChanges: {
		deployments: [],
		commits: [],
		configChanges: [
			createMockConfigChange({
				key: "DATABASE_POOL_SIZE",
				oldValue: "100",
				newValue: "25",
				timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
				source: "kubernetes-secret",
			}),
			createMockConfigChange({
				key: "CACHE_TTL_SECONDS",
				oldValue: "3600",
				newValue: "7200",
				timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
				source: "config-service",
			}),
		],
	},
	expectedFindings: {
		minCount: 1,
		types: ["config"],
		minRelevance: 60,
	},
	tags: ["config", "medium-confidence", "resource-exhaustion"],
};

/**
 * Scenario: Risky commit introduced bug
 *
 * A recent commit removed error handling that caused a regression.
 */
export const RISKY_COMMIT_SCENARIO: ChangeScenario = {
	name: "Code Bug After Commit",
	description: "A commit that removed null checks caused NullPointerException",
	recentChanges: {
		deployments: [
			createMockDeployment({
				id: "deploy-with-bug",
				service: "api-server",
				status: "success",
				riskScore: 70,
				riskFactors: ["deployed 1 hour before incident", "contains risky commit"],
				timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			}),
		],
		commits: [
			createRiskyCommit({
				sha: "abc1234567890",
				message: "perf: remove null check for faster execution",
				author: "developer@example.com",
				timestamp: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
			}),
			createMockCommit({
				message: "docs: update README with new API endpoints",
				timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
			}),
			createMockCommit({
				message: "test: add integration tests for UserService",
				timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
			}),
		],
		configChanges: [],
	},
	expectedFindings: {
		minCount: 2,
		types: ["deployment", "commit"],
		minRelevance: 70,
	},
	tags: ["commit", "code-bug", "high-confidence"],
};

/**
 * Scenario: Multiple potential causes
 *
 * A complex scenario with deployment, commits, and config changes all
 * happening around the incident time. Tests agent's ability to prioritize.
 */
export const MULTIPLE_CAUSES_SCENARIO: ChangeScenario = {
	name: "Multiple Potential Causes",
	description: "Deployment, commits, and config changes all happened recently",
	recentChanges: {
		deployments: [
			createMockDeployment({
				id: "deploy-recent",
				service: "api-server",
				status: "success",
				riskScore: 65,
				riskFactors: ["deployed 45 minutes before incident"],
				timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
			}),
		],
		commits: [
			createMockCommit({
				message: "refactor: update authentication flow",
				timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
			}),
			createRiskyCommit({
				message: "fix: quick patch for production issue",
				timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			}),
		],
		configChanges: [
			createMockConfigChange({
				key: "RATE_LIMIT_PER_SECOND",
				oldValue: "100",
				newValue: "500",
				timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
			}),
		],
	},
	expectedFindings: {
		minCount: 3,
		types: ["deployment", "commit", "config"],
		minRelevance: 50,
	},
	tags: ["complex", "multiple-causes", "prioritization"],
};

/**
 * Scenario: No recent changes
 *
 * No changes in the last 24 hours. Tests agent's behavior when change
 * tracking doesn't reveal the root cause.
 */
export const NO_CHANGES_SCENARIO: ChangeScenario = {
	name: "No Recent Changes",
	description: "No deployments, commits, or config changes in the last 24 hours",
	recentChanges: {
		deployments: [],
		commits: [],
		configChanges: [],
	},
	expectedFindings: {
		minCount: 0,
		types: [],
		minRelevance: 0,
	},
	tags: ["edge-case", "no-changes"],
};

/**
 * Scenario: Rollback in progress
 *
 * A deployment was rolled back due to the incident.
 */
export const ROLLBACK_SCENARIO: ChangeScenario = {
	name: "Deployment Rollback",
	description: "A deployment was rolled back after causing issues",
	recentChanges: {
		deployments: [
			createMockDeployment({
				id: "deploy-rolled-back",
				service: "api-server",
				status: "rolled_back",
				riskScore: 85,
				riskFactors: [
					"required rollback",
					"previous version restored",
					"deployed 30 minutes before incident",
				],
				timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
			}),
			createMockDeployment({
				id: "deploy-stable",
				service: "api-server",
				status: "success",
				riskScore: 20,
				riskFactors: ["stable deployment", "deployed 2 days ago"],
				timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
			}),
		],
		commits: [
			createMockCommit({
				message: "feat: add new payment processing flow",
				timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
			}),
		],
		configChanges: [],
	},
	expectedFindings: {
		minCount: 1,
		types: ["deployment"],
		minRelevance: 75,
	},
	tags: ["deployment", "rollback", "high-confidence"],
};

/**
 * Scenario: Database migration
 *
 * A deployment with a database migration was recently deployed.
 */
export const MIGRATION_SCENARIO: ChangeScenario = {
	name: "Database Migration",
	description: "A deployment containing a database migration was recently deployed",
	recentChanges: {
		deployments: [
			createMockDeployment({
				id: "deploy-migration",
				service: "api-server",
				status: "success",
				containsMigration: true,
				riskScore: 75,
				riskFactors: [
					"contains database migration",
					"schema changes detected",
					"deployed 20 minutes before incident",
				],
				timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
			}),
		],
		commits: [
			createMockCommit({
				message: "feat: add user preferences table",
				timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
			}),
		],
		configChanges: [],
	},
	expectedFindings: {
		minCount: 1,
		types: ["deployment"],
		minRelevance: 70,
	},
	tags: ["deployment", "migration", "database"],
};

// =============================================================================
// SCENARIO COLLECTIONS
// =============================================================================

/**
 * All available change scenarios.
 */
export const ALL_CHANGE_SCENARIOS: ChangeScenario[] = [
	FAILED_DEPLOYMENT_SCENARIO,
	CONFIG_CHANGE_SCENARIO,
	RISKY_COMMIT_SCENARIO,
	MULTIPLE_CAUSES_SCENARIO,
	NO_CHANGES_SCENARIO,
	ROLLBACK_SCENARIO,
	MIGRATION_SCENARIO,
];

/**
 * Get scenarios by tag.
 */
export function getScenariosByTag(tag: string): ChangeScenario[] {
	return ALL_CHANGE_SCENARIOS.filter((s) => s.tags.includes(tag));
}

/**
 * Get high-confidence scenarios (good for smoke tests).
 */
export function getHighConfidenceScenarios(): ChangeScenario[] {
	return getScenariosByTag("high-confidence");
}

/**
 * Get deployment-related scenarios.
 */
export function getDeploymentScenarios(): ChangeScenario[] {
	return getScenariosByTag("deployment");
}

/**
 * Get config-related scenarios.
 */
export function getConfigScenarios(): ChangeScenario[] {
	return getScenariosByTag("config");
}

/**
 * Get commit/code-related scenarios.
 */
export function getCodeScenarios(): ChangeScenario[] {
	return getScenariosByTag("commit").concat(getScenariosByTag("code-bug"));
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
	// Individual scenarios
	FAILED_DEPLOYMENT_SCENARIO,
	CONFIG_CHANGE_SCENARIO,
	RISKY_COMMIT_SCENARIO,
	MULTIPLE_CAUSES_SCENARIO,
	NO_CHANGES_SCENARIO,
	ROLLBACK_SCENARIO,
	MIGRATION_SCENARIO,
	// Collections
	ALL_CHANGE_SCENARIOS,
	// Utilities
	getScenariosByTag,
	getHighConfidenceScenarios,
	getDeploymentScenarios,
	getConfigScenarios,
	getCodeScenarios,
};
