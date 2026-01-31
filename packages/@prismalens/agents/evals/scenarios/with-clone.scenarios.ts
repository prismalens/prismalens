/**
 * Clone Scenarios for Agent Evaluation
 *
 * These scenarios test the agent's ability to use local repository tools.
 * Unlike other scenarios, these provide `clonePaths` which enables repo_* tools.
 *
 * MUTUAL EXCLUSIVITY:
 * - Clone scenarios: Have `clonePaths`, expect `repo_*` tools
 * - Non-clone scenarios: No `clonePaths`, `repo_*` tools are forbidden
 *
 * The test-repos directory contains mock repository files that match the
 * GitHub mock data, allowing repo tools to read real files.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
	createCodeBugScenario,
	createIncident,
	createAlert,
	type ScenarioDefinition,
} from "../fixtures/incidents.js";
import type { ScenarioWithMocks } from "./types.js";
import {
	createMockPreGatheredContext,
	createMockDeployment,
	createRiskyCommit,
	createMockCommit,
} from "../mocks/index.js";

// =============================================================================
// TEST REPOS PATH
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Base path to test repository fixtures */
export const TEST_REPOS_BASE = join(__dirname, "..", "fixtures", "test-repos");

/** Get path to a specific test repo */
export function getTestRepoPath(serviceName: string): string {
	return join(TEST_REPOS_BASE, serviceName);
}

// =============================================================================
// REPO TOOLS LIST (for trajectory validation)
// =============================================================================

/** Repo tools that should be called when clonePaths is provided */
export const REPO_TOOL_NAMES = [
	"repo_read_file",
	"repo_list_directory",
	"repo_search_text",
	"repo_get_file_info",
] as const;

// =============================================================================
// EASY CLONE SCENARIOS
// =============================================================================

/**
 * NullPointerException with cloned repository.
 * Agent should use repo tools to read the actual source code.
 */
export const clonedNullPointerException: ScenarioWithMocks = {
	...createCodeBugScenario("cloned-null-pointer-exception", {
		difficulty: "easy",
		input: {
			investigationId: "eval-clone-npe-001",
			incidentId: "inc-clone-npe-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-clone-npe-001",
				title: "High 5xx error rate on /api/users endpoint",
				description:
					"Users are experiencing 500 errors when accessing their profile. " +
					"Error logs show NullPointerException in UserService.getUser() at line 42. " +
					"The error started after deployment v2.3.1 approximately 30 minutes ago.",
				severity: "high",
				serviceName: "api-server",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-clone-npe-001",
					name: "HighErrorRate",
					message: "5xx error rate > 5% for api-server /api/users",
					severity: "high",
					annotations: {
						summary: "High error rate on users endpoint",
						endpoint: "/api/users",
						error_rate: "8.5%",
						threshold: "5%",
					},
				}),
				createAlert({
					alertId: "alert-clone-npe-002",
					name: "ExceptionSpike",
					message: "NullPointerException spike detected",
					severity: "high",
					annotations: {
						exception_type: "java.lang.NullPointerException",
						exception_location: "UserService.getUser(UserService.java:42)",
						stack_trace:
							"java.lang.NullPointerException\n" +
							"  at com.example.UserService.getUser(UserService.java:42)\n" +
							"  at com.example.UserController.getProfile(UserController.java:28)\n",
						count: "1247",
						first_seen: "2024-01-15T10:30:00Z",
					},
				}),
			],
			// Clone paths - enables repo tools
			clonePaths: {
				"api-server": getTestRepoPath("api-server"),
			},
			// Pre-gathered context
			preGatheredContext: createMockPreGatheredContext({
				serviceName: "api-server",
				recentChanges: {
					deployments: [
						createMockDeployment({
							id: "deploy-v231",
							service: "api-server",
							version: "v2.3.1",
							status: "success",
							riskScore: 75,
							riskFactors: [
								"deployed 30 minutes before incident",
								"contains code changes to UserService",
							],
							timestamp: "2024-01-15T10:00:00Z",
						}),
					],
					commits: [
						createRiskyCommit({
							sha: "abc123def",
							message: "perf: remove redundant null check in getUser() for faster response time",
							author: "developer@example.com",
							timestamp: "2024-01-14T15:30:00Z",
							repository: "org/api-server",
						}),
					],
					configChanges: [],
				},
				includeLogPreview: true,
				includeStackTraces: true,
			}),
		},
		expected: {
			status: "completed",
			minConfidence: 60,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["NullPointer", "null", "getUser", "UserService"],
			// CLONE-SPECIFIC: Expect at least one repo tool call
			expectedToolCalls: ["repo_read_file"],
			// No forbidden tools for clone scenarios
		},
	}),
	mocks: {
		// GitHub mocks are still used for API-based code search
		github: {
			searchCode: [
				{ file: "src/service/UserService.java", line: 22, snippet: "return user.getId();" },
				{ file: "src/service/UserService.java", line: 20, snippet: "User user = repository.findById(id);" },
			],
			listCommits: [
				{
					sha: "abc123def",
					message: "perf: remove redundant null check in getUser() for faster response time",
					author: "developer@example.com",
					date: "2024-01-14T15:30:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T10:30:15Z",
					level: "error",
					message: "java.lang.NullPointerException at com.example.service.UserService.getUser(UserService.java:22)",
				},
				{
					timestamp: "2024-01-15T10:30:14Z",
					level: "info",
					message: "Processing request GET /api/users/nonexistent-123",
				},
			],
			listServices: [
				{
					id: "srv-api-001",
					name: "api-server",
					status: "running",
					lastDeployedAt: "2024-01-14T16:00:00Z",
					lastDeployStatus: "succeeded",
				},
			],
		},
	},
	solutionHint:
		"Use repo_read_file to examine UserService.java source code directly. " +
		"The null check was removed at line 22, causing NPE when user is not found.",
	tags: ["clone", "easy", "npe", "null-check", "java", "repo-tools"],
};

/**
 * TypeScript undefined access with cloned repository.
 * Agent should use repo tools to read the order.ts file.
 */
export const clonedUndefinedAccess: ScenarioWithMocks = {
	...createCodeBugScenario("cloned-undefined-property-access", {
		difficulty: "easy",
		input: {
			investigationId: "eval-clone-undef-001",
			incidentId: "inc-clone-undef-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-clone-undef-001",
				title: "TypeError: Cannot read property 'id' of undefined",
				description:
					"The checkout flow is failing with TypeError. " +
					"Stack trace points to OrderService.processOrder where order.customer.id is accessed " +
					"but customer can be undefined when order is created via API directly.",
				severity: "high",
				serviceName: "checkout-service",
				alertCount: 2,
			}),
			alerts: [
				createAlert({
					alertId: "alert-clone-undef-001",
					name: "UnhandledException",
					message: "TypeError: Cannot read property 'id' of undefined",
					severity: "high",
					annotations: {
						error_type: "TypeError",
						error_message: "Cannot read property 'id' of undefined",
						location: "OrderService.processOrder:15",
						stack_trace:
							"TypeError: Cannot read property 'id' of undefined\n" +
							"    at OrderService.processOrder (src/services/order.ts:15:35)\n" +
							"    at CheckoutController.checkout (src/controllers/checkout.ts:42:20)\n",
					},
				}),
			],
			// Clone paths - enables repo tools
			clonePaths: {
				"checkout-service": getTestRepoPath("checkout-service"),
			},
			preGatheredContext: createMockPreGatheredContext({
				serviceName: "checkout-service",
				recentChanges: {
					deployments: [],
					commits: [
						createMockCommit({
							sha: "xyz789abc",
							message: "feat: add API order creation without customer requirement",
							author: "api-dev@example.com",
							timestamp: "2024-01-14T11:00:00Z",
						}),
					],
					configChanges: [],
				},
				includeLogPreview: true,
			}),
		},
		expected: {
			status: "completed",
			minConfidence: 60,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["undefined", "property", "customer", "id"],
			expectedToolCalls: ["repo_read_file"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/services/order.ts", line: 15, snippet: "const customerId = order.customer.id;" },
				{ file: "src/services/order.ts", line: 5, snippet: "customer?: Customer; // Optional customer" },
			],
			listCommits: [
				{
					sha: "xyz789abc",
					message: "feat: add API order creation without customer requirement",
					author: "api-dev@example.com",
					date: "2024-01-14T11:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T09:45:30Z",
					level: "error",
					message: "TypeError: Cannot read property 'id' of undefined at OrderService.processOrder (order.ts:15)",
				},
				{
					timestamp: "2024-01-15T09:45:29Z",
					level: "info",
					message: "Received POST /api/orders from API key: partner-api-key-123",
				},
			],
		},
	},
	solutionHint:
		"Use repo_read_file to examine order.ts. The customer field is optional (line 5) " +
		"but accessed without null check at line 15.",
	tags: ["clone", "easy", "typescript", "undefined", "optional-chaining", "repo-tools"],
};

// =============================================================================
// MEDIUM CLONE SCENARIOS
// =============================================================================

/**
 * Memory leak with cloned repository.
 * Agent should use repo tools to analyze the cache implementation.
 */
export const clonedMemoryLeak: ScenarioWithMocks = {
	...createCodeBugScenario("cloned-memory-leak", {
		difficulty: "medium",
		input: {
			investigationId: "eval-clone-memleak-001",
			incidentId: "inc-clone-memleak-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-clone-memleak-001",
				title: "Service degradation with increasing response times",
				description:
					"api-server response times have been increasing steadily over the past 6 hours. " +
					"Memory usage is also climbing. Restarting pods temporarily fixes the issue " +
					"but it returns after ~4 hours. Suspect memory leak in recent code change.",
				severity: "high",
				serviceName: "api-server",
				alertCount: 4,
			}),
			alerts: [
				createAlert({
					alertId: "alert-clone-memleak-001",
					name: "HighLatency",
					message: "P95 latency > 2s for api-server",
					severity: "high",
					annotations: {
						p50_latency: "800ms",
						p95_latency: "2.3s",
						p99_latency: "5.1s",
						normal_p95: "200ms",
					},
				}),
				createAlert({
					alertId: "alert-clone-memleak-002",
					name: "MemoryGrowth",
					message: "Heap memory usage increasing linearly",
					severity: "medium",
					annotations: {
						current_heap: "3.2GB",
						max_heap: "4GB",
						growth_rate: "100MB/hour",
					},
				}),
			],
			clonePaths: {
				"api-server": getTestRepoPath("api-server"),
			},
			preGatheredContext: createMockPreGatheredContext({
				serviceName: "api-server",
				recentChanges: {
					deployments: [],
					commits: [
						createMockCommit({
							sha: "mem123abc",
							message: "feat: add in-memory user cache for performance",
							author: "perf-engineer@example.com",
							timestamp: "2024-01-10T10:00:00Z",
						}),
					],
					configChanges: [],
				},
				includeLogPreview: true,
			}),
		},
		expected: {
			status: "completed",
			minConfidence: 40,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["memory", "leak", "cache", "heap"],
			expectedToolCalls: ["repo_read_file", "repo_search_text"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/cache/UserCache.ts", line: 7, snippet: "private cache = new Map<string, User>();" },
				{ file: "src/cache/UserCache.ts", line: 22, snippet: "this.cache.set(userId, user);" },
			],
			listCommits: [
				{
					sha: "mem123abc",
					message: "feat: add in-memory user cache for performance",
					author: "perf-engineer@example.com",
					date: "2024-01-10T10:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T16:00:00Z",
					level: "warn",
					message: "Heap usage at 80%: 3.2GB / 4GB. GC frequency elevated.",
				},
				{
					timestamp: "2024-01-15T12:00:00Z",
					level: "warn",
					message: "Heap usage at 60%: 2.4GB / 4GB. Consider memory profiling.",
				},
			],
		},
	},
	solutionHint:
		"Use repo_read_file and repo_search_text to analyze UserCache.ts. " +
		"The cache has no eviction policy, TTL, or size limit, causing unbounded growth.",
	tags: ["clone", "medium", "memory-leak", "cache", "performance", "repo-tools"],
};

// =============================================================================
// EXPORT ALL CLONE SCENARIOS
// =============================================================================

export const cloneScenarios: ScenarioWithMocks[] = [
	clonedNullPointerException,
	clonedUndefinedAccess,
	clonedMemoryLeak,
];

export const easyCloneScenarios = cloneScenarios.filter(
	(s) => s.difficulty === "easy",
);

export const mediumCloneScenarios = cloneScenarios.filter(
	(s) => s.difficulty === "medium",
);

export const hardCloneScenarios = cloneScenarios.filter(
	(s) => s.difficulty === "hard",
);
