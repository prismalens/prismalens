/**
 * Integration Factory
 *
 * Factory functions for creating test integration contexts.
 */

import { faker } from "@faker-js/faker";
import type { IntegrationContext } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

export interface GitHubIntegrationOptions {
	connectionId?: string;
	credentials?: {
		accessToken?: string;
		installationId?: number;
	};
	config?: {
		owner?: string;
		repo?: string;
		defaultBranch?: string;
	};
	serviceOverrides?: Record<string, unknown>;
}

export interface RenderIntegrationOptions {
	connectionId?: string;
	credentials?: {
		apiKey?: string;
	};
	config?: {
		teamId?: string;
		defaultServiceId?: string;
	};
	serviceOverrides?: Record<string, unknown>;
}

export interface GenericIntegrationOptions {
	type: string;
	connectionId?: string;
	credentials?: Record<string, unknown>;
	config?: Record<string, unknown>;
	serviceOverrides?: Record<string, unknown>;
}

// =============================================================================
// GITHUB INTEGRATION
// =============================================================================

/**
 * Create a GitHub integration context
 */
export function createGitHubIntegration(
	options: GitHubIntegrationOptions = {},
): IntegrationContext {
	return {
		type: "github",
		connectionId: options.connectionId ?? `gh-${faker.string.nanoid(8)}`,
		credentials: {
			accessToken: options.credentials?.accessToken ?? `ghp_${faker.string.alphanumeric(36)}`,
			installationId: options.credentials?.installationId ?? faker.number.int({ min: 10000, max: 99999 }),
		},
		config: {
			owner: options.config?.owner ?? faker.internet.username().toLowerCase(),
			repo: options.config?.repo ?? faker.lorem.word().toLowerCase(),
			defaultBranch: options.config?.defaultBranch ?? "main",
		},
		serviceOverrides: options.serviceOverrides,
	};
}

/**
 * Create a GitHub App integration (vs. PAT)
 */
export function createGitHubAppIntegration(
	options: GitHubIntegrationOptions = {},
): IntegrationContext {
	return {
		type: "github",
		connectionId: options.connectionId ?? `gh-app-${faker.string.nanoid(8)}`,
		credentials: {
			installationId: options.credentials?.installationId ?? faker.number.int({ min: 10000, max: 99999 }),
			appId: faker.number.int({ min: 100000, max: 999999 }),
			privateKey: `-----BEGIN RSA PRIVATE KEY-----\n${faker.string.alphanumeric(64)}\n-----END RSA PRIVATE KEY-----`,
		},
		config: {
			owner: options.config?.owner ?? faker.internet.username().toLowerCase(),
			repo: options.config?.repo ?? faker.lorem.word().toLowerCase(),
			defaultBranch: options.config?.defaultBranch ?? "main",
		},
		serviceOverrides: options.serviceOverrides,
	};
}

// =============================================================================
// RENDER INTEGRATION
// =============================================================================

/**
 * Create a Render integration context
 */
export function createRenderIntegration(
	options: RenderIntegrationOptions = {},
): IntegrationContext {
	return {
		type: "render",
		connectionId: options.connectionId ?? `rnd-${faker.string.nanoid(8)}`,
		credentials: {
			apiKey: options.credentials?.apiKey ?? `rnd_${faker.string.alphanumeric(32)}`,
		},
		config: {
			teamId: options.config?.teamId ?? `tea-${faker.string.nanoid(8)}`,
			defaultServiceId: options.config?.defaultServiceId ?? `srv-${faker.string.nanoid(8)}`,
		},
		serviceOverrides: options.serviceOverrides,
	};
}

// =============================================================================
// OTHER INTEGRATIONS
// =============================================================================

/**
 * Create a Datadog integration context
 */
export function createDatadogIntegration(
	options: Partial<GenericIntegrationOptions> = {},
): IntegrationContext {
	return {
		type: "datadog",
		connectionId: options.connectionId ?? `dd-${faker.string.nanoid(8)}`,
		credentials: {
			apiKey: `dd_${faker.string.alphanumeric(32)}`,
			appKey: `dd_app_${faker.string.alphanumeric(40)}`,
		},
		config: {
			site: "datadoghq.com",
		},
		serviceOverrides: options.serviceOverrides,
	};
}

/**
 * Create a PagerDuty integration context
 */
export function createPagerDutyIntegration(
	options: Partial<GenericIntegrationOptions> = {},
): IntegrationContext {
	return {
		type: "pagerduty",
		connectionId: options.connectionId ?? `pd-${faker.string.nanoid(8)}`,
		credentials: {
			apiKey: `pd_${faker.string.alphanumeric(20)}`,
		},
		config: {
			serviceId: `P${faker.string.alphanumeric(6).toUpperCase()}`,
		},
		serviceOverrides: options.serviceOverrides,
	};
}

/**
 * Create a generic integration context
 */
export function createGenericIntegration(
	options: GenericIntegrationOptions,
): IntegrationContext {
	return {
		type: options.type,
		connectionId: options.connectionId ?? `${options.type}-${faker.string.nanoid(8)}`,
		credentials: options.credentials ?? {},
		config: options.config ?? {},
		serviceOverrides: options.serviceOverrides,
	};
}

// =============================================================================
// COLLECTION FACTORIES
// =============================================================================

/**
 * Create a standard set of integrations for testing
 */
export function createStandardIntegrations(): IntegrationContext[] {
	return [
		createGitHubIntegration(),
		createRenderIntegration(),
	];
}

/**
 * Create integrations for a specific service with overrides
 */
export function createServiceIntegrations(
	serviceName: string,
	options: {
		github?: GitHubIntegrationOptions;
		render?: RenderIntegrationOptions;
	} = {},
): IntegrationContext[] {
	return [
		createGitHubIntegration({
			...options.github,
			serviceOverrides: {
				[serviceName]: {
					repo: serviceName,
				},
				...options.github?.serviceOverrides,
			},
		}),
		createRenderIntegration({
			...options.render,
			serviceOverrides: {
				[serviceName]: {
					serviceId: `srv-${serviceName}`,
				},
				...options.render?.serviceOverrides,
			},
		}),
	];
}

// =============================================================================
// INVALID/EDGE CASE FACTORIES
// =============================================================================

/**
 * Create an integration with invalid credentials (for testing error handling)
 */
export function createInvalidCredentialsIntegration(
	type: "github" | "render" = "github",
): IntegrationContext {
	if (type === "github") {
		return createGitHubIntegration({
			credentials: {
				accessToken: "invalid-token",
			},
		});
	}
	return createRenderIntegration({
		credentials: {
			apiKey: "invalid-key",
		},
	});
}

/**
 * Create an integration with missing required config
 */
export function createIncompleteIntegration(
	type: "github" | "render" = "github",
): IntegrationContext {
	if (type === "github") {
		return {
			type: "github",
			connectionId: `gh-incomplete`,
			credentials: {},
			config: {},
		};
	}
	return {
		type: "render",
		connectionId: `rnd-incomplete`,
		credentials: {},
		config: {},
	};
}
