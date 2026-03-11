"use client";

/**
 * Integration hooks using oRPC client
 *
 * Three-layer model: Template → Integration → Connection
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for integrations
 */
export const integrationsKeys = {
	all: () => orpc.integrations.key(),
	templates: {
		all: () => orpc.integrations.listTemplates.key(),
		detail: (id: string) =>
			orpc.integrations.getTemplate.key({ input: { id } }),
	},
	integrations: {
		all: () => orpc.integrations.listIntegrations.key(),
		detail: (id: string) =>
			orpc.integrations.getIntegration.key({ input: { id } }),
	},
	connections: {
		all: () => orpc.integrations.listConnections.key(),
		list: (params?: { templateId?: string }) =>
			orpc.integrations.listConnections.key({ input: params ?? {} }),
		detail: (id: string) =>
			orpc.integrations.getConnection.key({ input: { id } }),
	},
};

// =============================================================================
// TEMPLATES (from @prismalens/integrations package)
// =============================================================================

/**
 * Fetch all available integration templates
 */
export function useTemplates() {
	return useQuery(
		orpc.integrations.listTemplates.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch a single template by ID
 */
export function useTemplate(id: string) {
	return useQuery({
		...orpc.integrations.getTemplate.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

// =============================================================================
// INTEGRATIONS (OAuth client creds / provider instances)
// =============================================================================

/**
 * Fetch all integrations
 */
export function useIntegrations(params?: { templateId?: string }) {
	return useQuery(
		orpc.integrations.listIntegrations.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Create a new integration (OAuth client creds)
 */
export function useCreateIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.createIntegration.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.integrations.all(),
			});
		},
	});
}

/**
 * Delete an integration
 */
export function useDeleteIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.deleteIntegration.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.integrations.all(),
			});
		},
	});
}

// =============================================================================
// CONNECTIONS (user tokens / API keys)
// =============================================================================

/**
 * Fetch all connections with integration info
 */
export function useConnections(params?: {
	templateId?: string;
}) {
	return useQuery(
		orpc.integrations.listConnections.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single connection by ID
 */
export function useConnection(id: string) {
	return useQuery({
		...orpc.integrations.getConnection.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create a new connection (for API key / basic auth integrations)
 */
export function useCreateConnection() {
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
 * Update a connection
 */
export function useUpdateConnection() {
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
 * Delete a connection
 */
export function useDeleteConnection() {
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
 * Test a connection health
 */
export function useTestConnection() {
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
// GITHUB APP (installations)
// =============================================================================

/**
 * Fetch available GitHub App installations for an integration
 */
export function useGitHubInstallations(integrationId: string) {
	return useQuery({
		...orpc.integrations.listGitHubInstallations.queryOptions({
			input: { id: integrationId },
		}),
		enabled: !!integrationId,
	});
}

/**
 * Connect a GitHub App installation (creates a connection)
 */
export function useConnectGitHubInstallation() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.connectGitHubInstallation.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: integrationsKeys.connections.all(),
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
			queryClient.invalidateQueries({
				queryKey: orpc.integrations.key(),
			});
		},
	});
}
