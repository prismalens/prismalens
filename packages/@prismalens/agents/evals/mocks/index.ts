/**
 * Mock Infrastructure for GitHub + Render Integration Testing
 *
 * Provides scenario-embedded mocks for controlled, repeatable testing of agent
 * behavior without hitting real APIs. Designed to be extensible for future integrations.
 *
 * @see TESTING_PLAN.md for detailed design rationale
 */

import { vi, type MockInstance } from "vitest";

// =============================================================================
// MOCK RESPONSE TYPES - GitHub
// =============================================================================

/**
 * Code search result from GitHub
 */
export interface GitHubCodeSearchResult {
	file: string;
	line: number;
	snippet: string;
	repository?: string;
	sha?: string;
}

/**
 * Commit from GitHub
 */
export interface GitHubCommit {
	sha: string;
	message: string;
	author?: string;
	date: string;
	url?: string;
}

/**
 * GitHub mock configuration
 */
export interface GitHubMocks {
	/**
	 * Mock results for github_search_code tool
	 * Simulates searching for code patterns in repositories
	 */
	searchCode?: GitHubCodeSearchResult[];

	/**
	 * Mock file contents for github_get_file tool
	 * Map of file paths to their content
	 */
	getFile?: Record<string, string>;

	/**
	 * Mock commit history for github_list_commits tool
	 * Recent commits that might be related to the incident
	 */
	listCommits?: GitHubCommit[];
}

// =============================================================================
// MOCK RESPONSE TYPES - Render
// =============================================================================

/**
 * Log entry from Render
 */
export interface RenderLogEntry {
	timestamp: string;
	level: "error" | "warn" | "info" | "debug";
	message: string;
	service?: string;
	deployId?: string;
}

/**
 * Service status from Render
 */
export interface RenderService {
	id: string;
	name: string;
	status: "running" | "failed" | "deploying" | "suspended";
	lastDeployedAt?: string;
	lastDeployStatus?: "succeeded" | "failed" | "in_progress";
	region?: string;
}

/**
 * Render mock configuration
 */
export interface RenderMocks {
	/**
	 * Mock log entries for render_get_logs tool
	 * Application logs that would be returned from Render
	 */
	getLogs?: RenderLogEntry[];

	/**
	 * Mock service list for render_list_services tool
	 * Services and their current status
	 */
	listServices?: RenderService[];
}

// =============================================================================
// FUTURE INTEGRATION TYPES (Extensible)
// =============================================================================

/**
 * GitLab mocks (for when GitLab integration is added)
 */
export interface GitLabMocks {
	searchCode?: GitHubCodeSearchResult[];
	getFile?: Record<string, string>;
	listCommits?: GitHubCommit[];
}

/**
 * Datadog mocks (for when Datadog integration is added)
 */
export interface DatadogMocks {
	getLogs?: Array<{ timestamp: string; message: string; host: string }>;
	getMetrics?: Array<{ name: string; value: number; timestamp: string }>;
}

// =============================================================================
// COMBINED MOCK CONFIGURATION
// =============================================================================

/**
 * Integration mock configuration.
 * Each scenario can define its own mock responses for GitHub and Render.
 *
 * Extensible: Add new integration types here as they become available.
 */
export interface IntegrationMocks {
	/** GitHub API mocks (code search, file access, commits) */
	github?: GitHubMocks;

	/** Render API mocks (logs, services) */
	render?: RenderMocks;

	// Future integrations:
	// gitlab?: GitLabMocks;
	// datadog?: DatadogMocks;
	// kubernetes?: KubernetesMocks;
}

// =============================================================================
// MOCK STATE MANAGEMENT
// =============================================================================

/**
 * Current mock state - tracks what's been mocked
 */
let currentMocks: IntegrationMocks = {};
let mockFunctions: Map<string, MockInstance> = new Map();

// =============================================================================
// MOCK APPLICATION
// =============================================================================

/**
 * Apply mocks for GitHub and Render tools.
 *
 * This function configures Vitest mocks for the integration tools so that
 * agent tests can run with controlled, predictable data.
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *   applyMocks({
 *     github: {
 *       searchCode: [{ file: "src/UserService.java", line: 42, snippet: "return user.getId();" }],
 *       getFile: { "src/UserService.java": "public class UserService { ... }" },
 *       listCommits: [{ sha: "abc123", message: "Remove null check", date: "2024-01-14" }],
 *     },
 *     render: {
 *       getLogs: [{ timestamp: "2024-01-15T10:30:00Z", level: "error", message: "NPE at line 42" }],
 *     },
 *   });
 * });
 * ```
 */
export function applyMocks(mocks: IntegrationMocks): void {
	currentMocks = mocks;

	// Apply GitHub mocks
	if (mocks.github) {
		applyGitHubMocks(mocks.github);
	}

	// Apply Render mocks
	if (mocks.render) {
		applyRenderMocks(mocks.render);
	}

	// Future: Add more integration mock handlers here
	// if (mocks.gitlab) { applyGitLabMocks(mocks.gitlab); }
	// if (mocks.datadog) { applyDatadogMocks(mocks.datadog); }
}

/**
 * Apply GitHub-specific mocks
 */
function applyGitHubMocks(github: GitHubMocks): void {
	// Create mock implementations
	const searchCodeMock = vi.fn().mockImplementation(async (query: string) => {
		const results = github.searchCode ?? [];
		// Optionally filter by query if needed
		return {
			success: true,
			results: results.map((r) => ({
				path: r.file,
				lineNumber: r.line,
				content: r.snippet,
				repository: r.repository || "mock-org/mock-repo",
				sha: r.sha || "mock-sha",
			})),
			totalCount: results.length,
		};
	});

	const getFileMock = vi.fn().mockImplementation(async (path: string) => {
		const content = github.getFile?.[path];
		if (content === undefined) {
			return {
				success: false,
				error: `File not found: ${path}`,
			};
		}
		return {
			success: true,
			path,
			content,
			encoding: "utf-8",
		};
	});

	const listCommitsMock = vi.fn().mockImplementation(async () => {
		const commits = github.listCommits ?? [];
		return {
			success: true,
			commits: commits.map((c) => ({
				sha: c.sha,
				message: c.message,
				author: c.author || "mock-author",
				date: c.date,
				url: c.url || `https://github.com/mock/repo/commit/${c.sha}`,
			})),
			totalCount: commits.length,
		};
	});

	mockFunctions.set("github_search_code", searchCodeMock);
	mockFunctions.set("github_get_file", getFileMock);
	mockFunctions.set("github_list_commits", listCommitsMock);

	// Store references for getMockFunction
	(globalThis as any).__prismalens_mocks__ = {
		...(globalThis as any).__prismalens_mocks__,
		github_search_code: searchCodeMock,
		github_get_file: getFileMock,
		github_list_commits: listCommitsMock,
	};
}

/**
 * Apply Render-specific mocks
 */
function applyRenderMocks(render: RenderMocks): void {
	const getLogsMock = vi.fn().mockImplementation(async (options?: { serviceId?: string; level?: string }) => {
		let logs = render.getLogs ?? [];

		// Filter by level if specified
		if (options?.level) {
			const levels: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
			const minLevel = levels[options.level] ?? 2;
			logs = logs.filter((log) => (levels[log.level] ?? 2) <= minLevel);
		}

		return {
			success: true,
			logs: logs.map((l) => ({
				timestamp: l.timestamp,
				level: l.level,
				message: l.message,
				service: l.service || "mock-service",
				deployId: l.deployId,
			})),
			totalCount: logs.length,
		};
	});

	const listServicesMock = vi.fn().mockImplementation(async () => {
		const services = render.listServices ?? [];
		return {
			success: true,
			services: services.map((s) => ({
				id: s.id,
				name: s.name,
				status: s.status,
				lastDeployedAt: s.lastDeployedAt,
				lastDeployStatus: s.lastDeployStatus,
				region: s.region || "us-west",
			})),
			totalCount: services.length,
		};
	});

	mockFunctions.set("render_get_logs", getLogsMock);
	mockFunctions.set("render_list_services", listServicesMock);

	// Store references for getMockFunction
	(globalThis as any).__prismalens_mocks__ = {
		...(globalThis as any).__prismalens_mocks__,
		render_get_logs: getLogsMock,
		render_list_services: listServicesMock,
	};
}

// =============================================================================
// MOCK ACCESS
// =============================================================================

/**
 * Get a mock function by tool name.
 * Useful for assertions and spy verification.
 *
 * @example
 * ```typescript
 * const searchCodeMock = getMockFunction("github_search_code");
 * expect(searchCodeMock).toHaveBeenCalledWith("NullPointerException");
 * ```
 */
export function getMockFunction(toolName: string): MockInstance | undefined {
	return mockFunctions.get(toolName);
}

/**
 * Get current mock configuration.
 * Useful for debugging and verification.
 */
export function getCurrentMocks(): IntegrationMocks {
	return { ...currentMocks };
}

/**
 * Check if a specific integration is mocked.
 */
export function isMocked(integration: keyof IntegrationMocks): boolean {
	return currentMocks[integration] !== undefined;
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clear all mocks and reset state.
 * Call this in afterEach() to ensure clean test isolation.
 *
 * @example
 * ```typescript
 * afterEach(() => {
 *   clearMocks();
 * });
 * ```
 */
export function clearMocks(): void {
	// Reset all mock functions
	for (const [, mockFn] of mockFunctions) {
		mockFn.mockReset();
	}

	// Clear stored mocks
	mockFunctions.clear();
	currentMocks = {};

	// Clear global reference
	if ((globalThis as any).__prismalens_mocks__) {
		delete (globalThis as any).__prismalens_mocks__;
	}

	// Reset modules to clear any doMock calls
	vi.resetModules();
}

/**
 * Restore all mocks to their original implementations.
 * More aggressive than clearMocks - use when you want real implementations.
 */
export function restoreMocks(): void {
	clearMocks();
	vi.restoreAllMocks();
}

// =============================================================================
// MOCK HELPERS
// =============================================================================

/**
 * Create realistic GitHub code search results for a scenario.
 *
 * @example
 * ```typescript
 * const searchResults = createGitHubSearchResults([
 *   { file: "UserService.java", line: 42, pattern: "null check missing" },
 * ]);
 * ```
 */
export function createGitHubSearchResults(
	entries: Array<{ file: string; line: number; pattern: string }>,
): GitHubCodeSearchResult[] {
	return entries.map((e) => ({
		file: e.file,
		line: e.line,
		snippet: e.pattern,
		repository: "mock-org/mock-repo",
	}));
}

/**
 * Create realistic Render log entries for a scenario.
 *
 * @example
 * ```typescript
 * const logs = createRenderLogs([
 *   { level: "error", message: "NullPointerException at line 42" },
 *   { level: "info", message: "Request received" },
 * ]);
 * ```
 */
export function createRenderLogs(
	entries: Array<{ level: RenderLogEntry["level"]; message: string }>,
	baseTimestamp?: Date,
): RenderLogEntry[] {
	const base = baseTimestamp || new Date("2024-01-15T10:30:00Z");

	return entries.map((e, i) => ({
		timestamp: new Date(base.getTime() - i * 1000).toISOString(), // Each log 1s apart
		level: e.level,
		message: e.message,
		service: "mock-service",
	}));
}

/**
 * Create realistic GitHub commits for a scenario.
 *
 * @example
 * ```typescript
 * const commits = createGitHubCommits([
 *   { message: "perf: remove null check for performance" },
 *   { message: "feat: add user caching" },
 * ]);
 * ```
 */
export function createGitHubCommits(
	entries: Array<{ message: string; sha?: string }>,
	baseDate?: Date,
): GitHubCommit[] {
	const base = baseDate || new Date("2024-01-15T10:00:00Z");

	return entries.map((e, i) => ({
		sha: e.sha || `mock-sha-${i.toString().padStart(3, "0")}`,
		message: e.message,
		author: "mock-author",
		date: new Date(base.getTime() - i * 86400000).toISOString(), // Each commit 1 day apart
	}));
}

// =============================================================================
// RE-EXPORTS FROM NEW MOCK FILES
// =============================================================================

// Pre-gathered context factories (deployments, commits, config changes)
export * from "./pre-gathered.js";

// Change scenario presets
export * from "./change-scenarios.js";

// Full PreGatheredContext factory
export * from "./context-factory.js";

// =============================================================================
// EXPORTS
// =============================================================================

export default {
	applyMocks,
	clearMocks,
	restoreMocks,
	getMockFunction,
	getCurrentMocks,
	isMocked,
	createGitHubSearchResults,
	createRenderLogs,
	createGitHubCommits,
};
