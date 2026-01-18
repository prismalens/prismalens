/**
 * Render API Mocks
 *
 * Mock implementations and fixtures for Render.com API responses.
 * Used for deterministic testing of Render integration tools.
 */

import { vi } from "vitest";

// =============================================================================
// TYPES
// =============================================================================

export interface RenderService {
	id: string;
	name: string;
	slug: string;
	type: "web_service" | "background_worker" | "cron_job" | "static_site";
	env: "docker" | "node" | "python" | "go" | "rust";
	region: string;
	createdAt: string;
	updatedAt: string;
	suspended: "suspended" | "not_suspended";
	serviceDetails: {
		url?: string;
		buildCommand?: string;
		startCommand?: string;
	};
}

export interface RenderDeploy {
	id: string;
	commit: {
		id: string;
		message: string;
		createdAt: string;
	};
	status: "created" | "build_in_progress" | "update_in_progress" | "live" | "deactivated" | "build_failed" | "update_failed" | "canceled";
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface RenderLogEntry {
	id: string;
	timestamp: string;
	message: string;
	level: "info" | "warn" | "error";
}

export interface RenderEnvVar {
	key: string;
	value: string;
}

// =============================================================================
// MOCK RESPONSES
// =============================================================================

/**
 * Create a mock Render service
 */
export function createMockService(
	options: Partial<RenderService> = {},
): RenderService {
	return {
		id: "srv-123456",
		name: "api-service",
		slug: "api-service-abc",
		type: "web_service",
		env: "node",
		region: "oregon",
		createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
		updatedAt: new Date().toISOString(),
		suspended: "not_suspended",
		serviceDetails: {
			url: "https://api-service-abc.onrender.com",
			buildCommand: "npm install && npm run build",
			startCommand: "npm start",
		},
		...options,
	};
}

/**
 * Create mock deployment history
 */
export function createMockDeploys(
	count: number = 5,
	options: Partial<{
		latestFailed: boolean;
		serviceName: string;
	}> = {},
): RenderDeploy[] {
	const baseDate = new Date();

	return Array.from({ length: count }, (_, i) => {
		const isLatest = i === 0;
		const status = isLatest && options.latestFailed
			? "build_failed"
			: isLatest
				? "live"
				: "deactivated";

		const createdAt = new Date(baseDate.getTime() - i * 3600000);

		return {
			id: `dep-${i.toString().padStart(6, "0")}`,
			commit: {
				id: `commit-${i.toString().padStart(6, "0")}`,
				message: i === 0 ? "feat: update authentication" : `chore: maintenance ${i}`,
				createdAt: createdAt.toISOString(),
			},
			status,
			finishedAt: status === "live" || status === "build_failed"
				? new Date(createdAt.getTime() + 120000).toISOString()
				: null,
			createdAt: createdAt.toISOString(),
			updatedAt: createdAt.toISOString(),
		};
	});
}

/**
 * Create mock log entries
 */
export function createMockLogs(
	options: Partial<{
		count: number;
		includeError: boolean;
		errorMessage: string;
		serviceName: string;
	}> = {},
): RenderLogEntry[] {
	const count = options.count ?? 20;
	const baseDate = new Date();
	const logs: RenderLogEntry[] = [];

	for (let i = 0; i < count; i++) {
		const timestamp = new Date(baseDate.getTime() - (count - i) * 1000);

		// Insert error in the middle if requested
		if (options.includeError && i === Math.floor(count / 2)) {
			logs.push({
				id: `log-${i}`,
				timestamp: timestamp.toISOString(),
				message: options.errorMessage ?? "Error: NullPointerException in AuthHandler at line 42",
				level: "error",
			});
			continue;
		}

		logs.push({
			id: `log-${i}`,
			timestamp: timestamp.toISOString(),
			message: `[${options.serviceName ?? "api"}] Request processed successfully`,
			level: "info",
		});
	}

	return logs;
}

/**
 * Create mock environment variables
 */
export function createMockEnvVars(
	overrides: Record<string, string> = {},
): RenderEnvVar[] {
	const defaults: Record<string, string> = {
		NODE_ENV: "production",
		DATABASE_URL: "postgres://...",
		REDIS_URL: "redis://...",
		API_KEY: "sk-...",
	};

	return Object.entries({ ...defaults, ...overrides }).map(([key, value]) => ({
		key,
		value,
	}));
}

// =============================================================================
// MOCK AXIOS SETUP
// =============================================================================

export interface RenderMockConfig {
	services?: RenderService[];
	deploys?: Record<string, RenderDeploy[]>;
	logs?: Record<string, RenderLogEntry[]>;
	envVars?: Record<string, RenderEnvVar[]>;
	shouldFail?: boolean;
	failureMessage?: string;
}

/**
 * Setup mocked axios for Render API calls
 */
export function setupRenderMocks(config: RenderMockConfig = {}): void {
	const axios = vi.hoisted(() => ({
		default: {
			create: vi.fn(() => ({
				get: vi.fn(async (url: string) => {
					if (config.shouldFail) {
						throw new Error(config.failureMessage ?? "Render API error");
					}

					// List services
					if (url.match(/\/services$/)) {
						return {
							data: config.services ?? [createMockService()],
						};
					}

					// Get service details
					const serviceMatch = url.match(/\/services\/(srv-[a-z0-9]+)$/);
					if (serviceMatch) {
						const serviceId = serviceMatch[1];
						const service = config.services?.find((s) => s.id === serviceId)
							?? createMockService({ id: serviceId });
						return { data: service };
					}

					// Get deploys
					const deploysMatch = url.match(/\/services\/(srv-[a-z0-9]+)\/deploys/);
					if (deploysMatch) {
						const serviceId = deploysMatch[1];
						return {
							data: config.deploys?.[serviceId] ?? createMockDeploys(),
						};
					}

					// Get logs
					const logsMatch = url.match(/\/services\/(srv-[a-z0-9]+)\/logs/);
					if (logsMatch) {
						const serviceId = logsMatch[1];
						return {
							data: config.logs?.[serviceId] ?? createMockLogs(),
						};
					}

					// Get env vars
					const envMatch = url.match(/\/services\/(srv-[a-z0-9]+)\/env-vars/);
					if (envMatch) {
						const serviceId = envMatch[1];
						return {
							data: config.envVars?.[serviceId] ?? createMockEnvVars(),
						};
					}

					throw new Error(`Unmocked Render URL: ${url}`);
				}),
				post: vi.fn(),
				defaults: { headers: { common: {} } },
			})),
		},
	}));

	vi.mock("axios", () => axios);
}

// =============================================================================
// CASSETTE RECORDING/PLAYBACK
// =============================================================================

export interface RenderCassette {
	name: string;
	recordedAt: string;
	requests: Array<{
		method: string;
		url: string;
		response: {
			status: number;
			data: unknown;
		};
	}>;
}

/**
 * Load a Render API cassette
 */
export async function loadRenderCassette(cassettePath: string): Promise<RenderCassette> {
	const fs = await import("fs/promises");
	const content = await fs.readFile(cassettePath, "utf8");
	return JSON.parse(content);
}
