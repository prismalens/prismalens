/**
 * GitHub API Mocks
 *
 * Mock implementations and fixtures for GitHub API responses.
 * Used for deterministic testing of GitHub integration tools.
 */

import { vi } from "vitest";

// =============================================================================
// TYPES
// =============================================================================

export interface GitHubSearchCodeResult {
	total_count: number;
	incomplete_results: boolean;
	items: GitHubSearchCodeItem[];
}

export interface GitHubSearchCodeItem {
	name: string;
	path: string;
	sha: string;
	url: string;
	html_url: string;
	repository: {
		id: number;
		name: string;
		full_name: string;
	};
	text_matches?: Array<{
		fragment: string;
		matches: Array<{
			text: string;
			indices: number[];
		}>;
	}>;
}

export interface GitHubFileContent {
	name: string;
	path: string;
	sha: string;
	size: number;
	content: string; // Base64 encoded
	encoding: "base64";
	html_url: string;
}

export interface GitHubCommit {
	sha: string;
	commit: {
		message: string;
		author: {
			name: string;
			email: string;
			date: string;
		};
	};
	html_url: string;
	author: {
		login: string;
		avatar_url: string;
	} | null;
}

// =============================================================================
// MOCK RESPONSES
// =============================================================================

/**
 * Create a mock GitHub code search result
 */
export function createMockSearchCodeResult(
	options: Partial<{
		query: string;
		items: Partial<GitHubSearchCodeItem>[];
		totalCount: number;
	}> = {},
): GitHubSearchCodeResult {
	const defaultItems: GitHubSearchCodeItem[] = [
		{
			name: "auth-handler.ts",
			path: "src/services/auth-handler.ts",
			sha: "abc123",
			url: "https://api.github.com/repos/owner/repo/contents/src/services/auth-handler.ts",
			html_url: "https://github.com/owner/repo/blob/main/src/services/auth-handler.ts",
			repository: {
				id: 123456,
				name: "repo",
				full_name: "owner/repo",
			},
			text_matches: [
				{
					fragment: "NullPointerException",
					matches: [{ text: "NullPointerException", indices: [0, 19] }],
				},
			],
		},
	];

	return {
		total_count: options.totalCount ?? options.items?.length ?? defaultItems.length,
		incomplete_results: false,
		items: options.items?.map((item, i) => ({
			...defaultItems[0],
			...item,
			repository: {
				...defaultItems[0].repository,
				...item.repository,
			},
		})) ?? defaultItems,
	};
}

/**
 * Create a mock file content response
 */
export function createMockFileContent(
	options: Partial<{
		path: string;
		content: string;
		name: string;
	}> = {},
): GitHubFileContent {
	const content = options.content ?? `export function handleAuth(user: User) {
  // Bug: Missing null check
  return user.id.toString();
}`;

	return {
		name: options.name ?? "auth-handler.ts",
		path: options.path ?? "src/services/auth-handler.ts",
		sha: "abc123def456",
		size: Buffer.byteLength(content, "utf8"),
		content: Buffer.from(content).toString("base64"),
		encoding: "base64",
		html_url: `https://github.com/owner/repo/blob/main/${options.path ?? "src/services/auth-handler.ts"}`,
	};
}

/**
 * Create mock commit history
 */
export function createMockCommits(
	count: number = 3,
): GitHubCommit[] {
	const baseDate = new Date();
	return Array.from({ length: count }, (_, i) => ({
		sha: `sha${i.toString().padStart(6, "0")}`,
		commit: {
			message: i === 0 ? "fix: resolve auth issue" : `chore: update ${i}`,
			author: {
				name: "Test User",
				email: "test@example.com",
				date: new Date(baseDate.getTime() - i * 3600000).toISOString(),
			},
		},
		html_url: `https://github.com/owner/repo/commit/sha${i.toString().padStart(6, "0")}`,
		author: {
			login: "testuser",
			avatar_url: "https://github.com/testuser.png",
		},
	}));
}

// =============================================================================
// MOCK AXIOS SETUP
// =============================================================================

export interface GitHubMockConfig {
	searchResults?: GitHubSearchCodeResult;
	fileContents?: Record<string, GitHubFileContent>;
	commits?: GitHubCommit[];
	rateLimitRemaining?: number;
	shouldFail?: boolean;
	failureMessage?: string;
}

/**
 * Create mocked axios for GitHub API calls
 */
export function setupGitHubMocks(config: GitHubMockConfig = {}): void {
	const axios = vi.hoisted(() => ({
		default: {
			create: vi.fn(() => ({
				get: vi.fn(async (url: string) => {
					if (config.shouldFail) {
						throw new Error(config.failureMessage ?? "GitHub API error");
					}

					// Handle rate limit headers
					const headers = {
						"x-ratelimit-remaining": String(config.rateLimitRemaining ?? 5000),
						"x-ratelimit-limit": "5000",
					};

					// Route to appropriate mock
					if (url.includes("/search/code")) {
						return {
							data: config.searchResults ?? createMockSearchCodeResult(),
							headers,
						};
					}

					if (url.includes("/contents/")) {
						const path = url.split("/contents/")[1];
						const content = config.fileContents?.[path] ?? createMockFileContent({ path });
						return { data: content, headers };
					}

					if (url.includes("/commits")) {
						return {
							data: config.commits ?? createMockCommits(),
							headers,
						};
					}

					throw new Error(`Unmocked GitHub URL: ${url}`);
				}),
				post: vi.fn(),
				defaults: { headers: { common: {} } },
			})),
		},
	}));

	vi.mock("axios", () => axios);
}

// =============================================================================
// CASSETTE RECORDING/PLAYBACK (VCR-style)
// =============================================================================

export interface GitHubCassette {
	name: string;
	recordedAt: string;
	requests: Array<{
		method: string;
		url: string;
		response: {
			status: number;
			data: unknown;
			headers: Record<string, string>;
		};
	}>;
}

/**
 * Load a cassette for playback
 */
export async function loadGitHubCassette(cassettePath: string): Promise<GitHubCassette> {
	const fs = await import("fs/promises");
	const content = await fs.readFile(cassettePath, "utf8");
	return JSON.parse(content);
}

/**
 * Create a mock axios that replays cassette responses
 */
export function createCassettePlayer(cassette: GitHubCassette) {
	let requestIndex = 0;

	return {
		get: vi.fn(async (url: string) => {
			const request = cassette.requests[requestIndex++];
			if (!request) {
				throw new Error(`Cassette exhausted after ${requestIndex} requests`);
			}

			if (!url.includes(new URL(request.url).pathname)) {
				throw new Error(
					`Cassette mismatch: expected ${request.url}, got ${url}`
				);
			}

			return {
				status: request.response.status,
				data: request.response.data,
				headers: request.response.headers,
			};
		}),
	};
}
