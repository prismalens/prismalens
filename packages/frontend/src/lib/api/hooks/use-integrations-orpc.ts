"use client";

/**
 * Integration hooks using oRPC client
 *
 * Type-safe hooks for integration management using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for integrations
 */
export const integrationsKeys = {
	all: () => orpc.integrations.key(),
	definitions: {
		all: () => orpc.integrations.listDefinitions.key(),
		detail: (id: string) =>
			orpc.integrations.getDefinition.key({ input: { id } }),
	},
	connections: {
		all: () => orpc.integrations.listConnections.key(),
		list: (params?: { definitionId?: string; category?: string }) =>
			orpc.integrations.listConnections.key({ input: params ?? {} }),
		detail: (id: string) =>
			orpc.integrations.getConnection.key({ input: { id } }),
	},
};

// =============================================================================
// INTEGRATION DEFINITIONS (Catalog)
// =============================================================================

/**
 * Fetch all available integration definitions (GitHub, Prometheus, Slack)
 */
export function useIntegrationDefinitions() {
	return useQuery(
		orpc.integrations.listDefinitions.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch a single integration definition by ID
 */
export function useIntegrationDefinition(id: string) {
	return useQuery({
		...orpc.integrations.getDefinition.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

// =============================================================================
// INTEGRATION CONNECTIONS (User instances)
// =============================================================================

/**
 * Fetch all integration connections
 */
export function useIntegrationConnections(params?: {
	definitionId?: string;
	category?: string;
}) {
	return useQuery(
		orpc.integrations.listConnections.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single integration connection by ID
 */
export function useIntegrationConnection(id: string) {
	return useQuery({
		...orpc.integrations.getConnection.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create a new integration connection (for API key integrations)
 */
export function useCreateIntegrationConnection() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.createConnection.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.all(),
			});
		},
	});
}

/**
 * Update an integration connection
 */
export function useUpdateIntegrationConnection() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.updateConnection.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.all(),
			});
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.detail(variables.id),
			});
		},
	});
}

/**
 * Delete an integration connection
 */
export function useDeleteIntegrationConnection() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.deleteConnection.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.all(),
			});
		},
	});
}

/**
 * Test an integration connection health
 */
export function useTestIntegrationConnection() {
	return useMutation({
		...orpc.integrations.testConnection.mutationOptions(),
	});
}

// =============================================================================
// GIT PROVIDER (GitHub, GitLab, BitBucket)
// =============================================================================

/**
 * Fetch organizations from a git provider connection
 */
export function useGitOrganizations(connectionId: string) {
	return useQuery({
		...orpc.integrations.getGitOrganizations.queryOptions({
			input: { id: connectionId },
		}),
		enabled: !!connectionId,
	});
}

/**
 * Fetch repositories from a git provider connection
 */
export function useGitRepositories(connectionId: string, org?: string) {
	return useQuery({
		...orpc.integrations.getGitRepositories.queryOptions({
			input: { id: connectionId, org },
		}),
		enabled: !!connectionId,
	});
}

/**
 * Update connection config (e.g., selected repos after OAuth)
 */
export function useUpdateConnectionConfig() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.updateConnectionConfig.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.all(),
			});
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.detail(variables.id),
			});
		},
	});
}

// =============================================================================
// SERVICE INTEGRATIONS (Per-service overrides)
// =============================================================================

/**
 * Query key factory for service integrations
 */
export const serviceIntegrationsKeys = {
	forService: (serviceId: string) =>
		orpc.integrations.getServiceIntegrations.key({ input: { serviceId } }),
};

/**
 * Fetch integrations for a service with override status
 */
export function useServiceIntegrations(serviceId: string) {
	return useQuery({
		...orpc.integrations.getServiceIntegrations.queryOptions({
			input: { serviceId },
		}),
		enabled: !!serviceId,
	});
}

/**
 * Create a service integration override
 */
export function useCreateServiceIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.createServiceIntegration.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: serviceIntegrationsKeys.forService(variables.serviceId),
			});
		},
	});
}

/**
 * Update a service integration override
 */
export function useUpdateServiceIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.updateServiceIntegration.mutationOptions(),
		onSuccess: () => {
			// Invalidate all service integrations since we don't know which service
			queryClient.invalidateQueries({
				queryKey: orpc.integrations.key(),
			});
		},
	});
}

/**
 * Delete a service integration override
 */
export function useDeleteServiceIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.deleteServiceIntegration.mutationOptions(),
		onSuccess: () => {
			// Invalidate all service integrations since we don't know which service
			queryClient.invalidateQueries({
				queryKey: orpc.integrations.key(),
			});
		},
	});
}
