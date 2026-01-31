/**
 * Pre-Gathered Context Mock Factories
 *
 * Factory functions for creating mock deployment, commit, and config change data
 * for ChangeTracker agent evaluations.
 *
 * These factories create data that ChangeTracker expects in state.preGatheredContext.recentChanges.
 */

import { faker } from "@faker-js/faker";
import type {
	CommitChange,
	ConfigChange,
	DeploymentChange,
	RecentChangesContext,
} from "../../src/types/state.js";

// =============================================================================
// DEPLOYMENT FACTORIES
// =============================================================================

export interface CreateDeploymentOptions {
	id?: string;
	timestamp?: string;
	service?: string;
	environment?: string;
	version?: string;
	status?: "success" | "failed" | "rolled_back" | "in_progress";
	containsMigration?: boolean;
	riskScore?: number;
	riskFactors?: string[];
	url?: string;
}

/**
 * Create a mock deployment with risk scoring.
 *
 * @example
 * ```typescript
 * const deployment = createMockDeployment({
 *   service: "api-server",
 *   status: "failed",
 *   riskScore: 85,
 *   riskFactors: ["deployed 15 min before incident", "contains migration"],
 * });
 * ```
 */
export function createMockDeployment(options: CreateDeploymentOptions = {}): DeploymentChange {
	const id = options.id || `deploy-${faker.string.alphanumeric(8)}`;
	const status = options.status || faker.helpers.arrayElement(["success", "failed", "rolled_back"]);

	// Calculate default risk score based on status
	let defaultRiskScore = 50;
	if (status === "failed") defaultRiskScore = 80;
	if (status === "rolled_back") defaultRiskScore = 75;
	if (options.containsMigration) defaultRiskScore += 15;

	return {
		id,
		timestamp: options.timestamp || new Date().toISOString(),
		service: options.service || faker.helpers.arrayElement([
			"api-server",
			"web-frontend",
			"auth-service",
			"payment-service",
			"worker-service",
		]),
		environment: options.environment || "production",
		version: options.version || `v${faker.number.int({ min: 1, max: 5 })}.${faker.number.int({ min: 0, max: 20 })}.${faker.number.int({ min: 0, max: 100 })}`,
		status,
		containsMigration: options.containsMigration ?? faker.datatype.boolean({ probability: 0.2 }),
		riskScore: options.riskScore ?? Math.min(100, defaultRiskScore),
		riskFactors: options.riskFactors || generateRiskFactors(status, options.containsMigration),
		url: options.url || `https://render.com/deploys/${id}`,
	};
}

/**
 * Generate realistic risk factors based on deployment characteristics.
 */
function generateRiskFactors(
	status: DeploymentChange["status"],
	containsMigration?: boolean,
): string[] {
	const factors: string[] = [];

	if (status === "failed") {
		factors.push("deployment failed");
		factors.push(faker.helpers.arrayElement([
			"build error",
			"health check failed",
			"timeout during rollout",
		]));
	}

	if (status === "rolled_back") {
		factors.push("required rollback");
		factors.push("previous version restored");
	}

	if (containsMigration) {
		factors.push("contains database migration");
	}

	// Add time-based factors
	factors.push(faker.helpers.arrayElement([
		"deployed within 1 hour of incident",
		"deployed within 15 minutes of incident",
		"deployed outside maintenance window",
	]));

	return factors;
}

/**
 * Create multiple deployments with realistic timing.
 *
 * @example
 * ```typescript
 * const deployments = createMockDeployments(3, { service: "api-server" });
 * ```
 */
export function createMockDeployments(
	count: number,
	baseOptions: CreateDeploymentOptions = {},
	baseTimestamp?: Date,
): DeploymentChange[] {
	const base = baseTimestamp || new Date();

	return Array.from({ length: count }, (_, i) => {
		// Each deployment gets progressively older (1 hour apart)
		const timestamp = new Date(base.getTime() - i * 60 * 60 * 1000);
		return createMockDeployment({
			...baseOptions,
			timestamp: timestamp.toISOString(),
		});
	});
}

// =============================================================================
// COMMIT FACTORIES
// =============================================================================

export interface CreateCommitOptions {
	sha?: string;
	message?: string;
	author?: string;
	timestamp?: string;
	repository?: string;
	url?: string;
}

/**
 * Create a mock commit.
 *
 * @example
 * ```typescript
 * const commit = createMockCommit({
 *   message: "fix: remove null check that caused NPE",
 *   author: "developer@example.com",
 * });
 * ```
 */
export function createMockCommit(options: CreateCommitOptions = {}): CommitChange {
	const sha = options.sha || faker.git.commitSha();

	return {
		sha,
		message: options.message || generateCommitMessage(),
		author: options.author || faker.internet.email(),
		timestamp: options.timestamp || new Date().toISOString(),
		repository: options.repository || "org/repo",
		url: options.url || `https://github.com/org/repo/commit/${sha}`,
	};
}

/**
 * Generate a realistic commit message.
 */
function generateCommitMessage(): string {
	const types = ["fix", "feat", "refactor", "perf", "chore", "docs"];
	const type = faker.helpers.arrayElement(types);

	const subjects = [
		"update error handling in UserService",
		"remove null check for performance",
		"add retry logic to API client",
		"optimize database queries",
		"fix memory leak in worker",
		"update configuration defaults",
		"refactor authentication flow",
		"add rate limiting to endpoints",
	];

	return `${type}: ${faker.helpers.arrayElement(subjects)}`;
}

/**
 * Create multiple commits with realistic timing.
 *
 * @example
 * ```typescript
 * const commits = createMockCommits(5, { repository: "org/api-server" });
 * ```
 */
export function createMockCommits(
	count: number,
	baseOptions: CreateCommitOptions = {},
	baseTimestamp?: Date,
): CommitChange[] {
	const base = baseTimestamp || new Date();

	return Array.from({ length: count }, (_, i) => {
		// Each commit gets progressively older (2 hours apart)
		const timestamp = new Date(base.getTime() - i * 2 * 60 * 60 * 1000);
		return createMockCommit({
			...baseOptions,
			timestamp: timestamp.toISOString(),
		});
	});
}

/**
 * Create a "risky" commit that likely caused a bug.
 */
export function createRiskyCommit(options: CreateCommitOptions = {}): CommitChange {
	const riskyMessages = [
		"perf: remove null check for faster execution",
		"fix: quick patch for production issue",
		"hotfix: disable validation temporarily",
		"refactor: simplify error handling",
		"chore: update dependencies",
		"fix: remove unused try-catch block",
	];

	return createMockCommit({
		...options,
		message: options.message || faker.helpers.arrayElement(riskyMessages),
	});
}

// =============================================================================
// CONFIG CHANGE FACTORIES
// =============================================================================

export interface CreateConfigChangeOptions {
	key?: string;
	oldValue?: string;
	newValue?: string;
	timestamp?: string;
	source?: string;
}

/**
 * Create a mock configuration change.
 *
 * @example
 * ```typescript
 * const configChange = createMockConfigChange({
 *   key: "DATABASE_POOL_SIZE",
 *   oldValue: "50",
 *   newValue: "100",
 * });
 * ```
 */
export function createMockConfigChange(options: CreateConfigChangeOptions = {}): ConfigChange {
	const configKeys = [
		"DATABASE_POOL_SIZE",
		"REDIS_TIMEOUT_MS",
		"MAX_CONNECTIONS",
		"RATE_LIMIT_PER_SECOND",
		"CACHE_TTL_SECONDS",
		"WORKER_CONCURRENCY",
		"API_TIMEOUT_MS",
		"FEATURE_FLAG_NEW_AUTH",
	];

	const key = options.key || faker.helpers.arrayElement(configKeys);

	return {
		key,
		oldValue: options.oldValue || generateConfigValue(key, "old"),
		newValue: options.newValue || generateConfigValue(key, "new"),
		timestamp: options.timestamp || new Date().toISOString(),
		source: options.source || faker.helpers.arrayElement([
			"environment",
			"config-service",
			"kubernetes-secret",
			"vault",
		]),
	};
}

/**
 * Generate realistic config values based on key name.
 */
function generateConfigValue(key: string, variant: "old" | "new"): string {
	if (key.includes("SIZE") || key.includes("CONNECTIONS") || key.includes("CONCURRENCY")) {
		const base = faker.number.int({ min: 10, max: 100 });
		return variant === "old" ? String(base) : String(base * 2);
	}

	if (key.includes("TIMEOUT") || key.includes("TTL")) {
		const base = faker.number.int({ min: 1000, max: 30000 });
		return variant === "old" ? String(base) : String(Math.floor(base / 2));
	}

	if (key.includes("RATE_LIMIT")) {
		const base = faker.number.int({ min: 100, max: 1000 });
		return variant === "old" ? String(base) : String(base * 2);
	}

	if (key.includes("FEATURE_FLAG")) {
		return variant === "old" ? "false" : "true";
	}

	return variant === "old" ? "default" : "custom";
}

/**
 * Create multiple config changes.
 */
export function createMockConfigChanges(
	count: number,
	baseOptions: CreateConfigChangeOptions = {},
	baseTimestamp?: Date,
): ConfigChange[] {
	const base = baseTimestamp || new Date();

	return Array.from({ length: count }, (_, i) => {
		const timestamp = new Date(base.getTime() - i * 30 * 60 * 1000); // 30 min apart
		return createMockConfigChange({
			...baseOptions,
			timestamp: timestamp.toISOString(),
		});
	});
}

// =============================================================================
// COMBINED FACTORIES
// =============================================================================

export interface CreateRecentChangesOptions {
	deployments?: DeploymentChange[];
	commits?: CommitChange[];
	configChanges?: ConfigChange[];
	/** Number of deployments to auto-generate if not provided */
	deploymentCount?: number;
	/** Number of commits to auto-generate if not provided */
	commitCount?: number;
	/** Number of config changes to auto-generate if not provided */
	configChangeCount?: number;
	/** Base timestamp for all changes */
	baseTimestamp?: Date;
}

/**
 * Create a full RecentChangesContext with deployments, commits, and config changes.
 *
 * @example
 * ```typescript
 * const changes = createMockRecentChanges({
 *   deploymentCount: 2,
 *   commitCount: 5,
 *   configChangeCount: 1,
 * });
 * ```
 */
export function createMockRecentChanges(options: CreateRecentChangesOptions = {}): RecentChangesContext {
	const base = options.baseTimestamp || new Date();

	return {
		deployments: options.deployments ||
			(options.deploymentCount ? createMockDeployments(options.deploymentCount, {}, base) : []),
		commits: options.commits ||
			(options.commitCount ? createMockCommits(options.commitCount, {}, base) : []),
		configChanges: options.configChanges ||
			(options.configChangeCount ? createMockConfigChanges(options.configChangeCount, {}, base) : []),
	};
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
	createMockDeployment,
	createMockDeployments,
	createMockCommit,
	createMockCommits,
	createRiskyCommit,
	createMockConfigChange,
	createMockConfigChanges,
	createMockRecentChanges,
};
