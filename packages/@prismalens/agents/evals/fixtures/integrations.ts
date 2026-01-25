/**
 * Integration Fixtures for Evaluations
 *
 * Provides helpers for creating IntegrationContext from test database.
 * Follows the single source of truth principle - credentials come from DB.
 */

import type { IntegrationContext } from "../../src/types/state.js";

// =============================================================================
// INTEGRATION CONTEXT BUILDERS
// =============================================================================

/**
 * Map database IntegrationConnection to IntegrationContext.
 * Used when fetching integrations from test.db via oRPC.
 */
export interface DBIntegrationConnection {
	id: string;
	definitionId: string;
	name: string;
	status: string;
	config: Record<string, unknown> | null;
	definition?: {
		name: string;
	};
	// Note: credentials are decrypted before passing here
	decryptedCredentials?: Record<string, unknown>;
}

export function mapToIntegrationContext(
	connection: DBIntegrationConnection,
): IntegrationContext {
	return {
		type: connection.definition?.name || "unknown",
		connectionId: connection.id,
		credentials: connection.decryptedCredentials || {},
		config: connection.config || {},
	};
}

// =============================================================================
// MOCK INTEGRATIONS (for component tests without DB)
// =============================================================================

/**
 * Create a mock GitHub integration context.
 * Use only for component tests where DB is not available.
 */
export function createMockGitHubIntegration(
	overrides: Partial<IntegrationContext> = {},
): IntegrationContext {
	return {
		type: "github",
		connectionId: "mock-github",
		credentials: {
			accessToken: "mock-github-token",
		},
		config: {
			owner: "test-org",
			repo: "test-repo",
		},
		...overrides,
	};
}

/**
 * Create a mock Render integration context.
 * Use only for component tests where DB is not available.
 */
export function createMockRenderIntegration(
	overrides: Partial<IntegrationContext> = {},
): IntegrationContext {
	return {
		type: "render",
		connectionId: "mock-render",
		credentials: {
			apiKey: "mock-render-key",
		},
		config: {
			serviceId: "srv-mock",
		},
		...overrides,
	};
}

// =============================================================================
// INTEGRATION AVAILABILITY CHECK
// =============================================================================

/**
 * Check which integration types are available.
 */
export function getAvailableIntegrationTypes(
	integrations: IntegrationContext[],
): string[] {
	return integrations.map((i) => i.type);
}

/**
 * Check if a specific integration type is available.
 */
export function hasIntegrationType(
	integrations: IntegrationContext[],
	type: string,
): boolean {
	return integrations.some((i) => i.type === type);
}
