"use client";

/**
 * Settings hooks using oRPC client
 *
 * Type-safe hooks for LLM configuration operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for settings
 * Uses oRPC's built-in key generation for consistency
 */
export const settingsKeys = {
	all: () => orpc.settings.key(),
	llm: {
		all: () => orpc.settings.llm.key(),
		list: () => orpc.settings.llm.list.key(),
		detail: (provider: string) =>
			orpc.settings.llm.get.key({ input: { provider } }),
	},
};

/**
 * Fetch all LLM provider configurations
 */
export function useLlmConfigs() {
	return useQuery(
		orpc.settings.llm.list.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch LLM configuration for a specific provider
 */
export function useLlmConfig(provider: string) {
	return useQuery({
		...orpc.settings.llm.get.queryOptions({
			input: { provider },
		}),
		enabled: !!provider,
	});
}

/**
 * Update LLM configuration for a provider
 */
export function useUpdateLlmConfig() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.llm.update.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: settingsKeys.llm.list() });
			queryClient.invalidateQueries({
				queryKey: settingsKeys.llm.detail(variables.provider),
			});
		},
	});
}

/**
 * Delete LLM configuration for a provider
 */
export function useDeleteLlmConfig() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.llm.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: settingsKeys.llm.list() });
		},
	});
}

/**
 * Test LLM connection with provided credentials
 * Does not modify any data, just validates the connection
 */
export function useTestLlmConnection() {
	return useMutation({
		...orpc.settings.llm.test.mutationOptions(),
	});
}

/**
 * Set the active LLM provider
 */
export function useSetActiveLlmProvider() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.llm.setActive.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: settingsKeys.llm.list() });
		},
	});
}

// =============================================================================
// COMPREHENSIVE LLM CONFIGURATION (ENV-ONLY API KEYS)
// =============================================================================

/**
 * Query key factory for new LLM settings
 */
export const llmSettingsKeys = {
	envStatus: () => orpc.settings.llm.getEnvStatus.key(),
	settings: () => orpc.settings.llm.getSettings.key(),
	models: (provider?: string) =>
		orpc.settings.llm.getModels.key({ input: { provider } }),
};

/**
 * Fetch environment variable status for all providers
 * Shows which providers have API keys configured via env vars
 */
export function useLlmEnvStatus() {
	return useQuery(
		orpc.settings.llm.getEnvStatus.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch comprehensive LLM settings (model, temperature, per-agent overrides)
 */
export function useLlmSettings() {
	return useQuery(
		orpc.settings.llm.getSettings.queryOptions({
			input: {},
		}),
	);
}

/**
 * Update LLM settings (partial update)
 */
export function useUpdateLlmSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.llm.updateSettings.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: llmSettingsKeys.settings() });
		},
	});
}

/**
 * Fetch available models from the models registry
 * Optionally filter by provider
 */
export function useLlmModels(provider?: string) {
	return useQuery({
		...orpc.settings.llm.getModels.queryOptions({
			input: { provider },
		}),
		staleTime: 24 * 60 * 60 * 1000, // 24 hours - models list rarely changes
	});
}

/**
 * Test LLM connection using environment variables (no API key input)
 */
export function useTestLlmConnectionWithEnv() {
	return useMutation({
		...orpc.settings.llm.testConnection.mutationOptions(),
	});
}

// =============================================================================
// INVESTIGATION POLICIES
// =============================================================================

/**
 * Fetch investigation policies for all tiers
 */
export function useInvestigationPolicies() {
	return useQuery(
		orpc.settings.investigation.getPolicies.queryOptions({
			input: {},
		}),
	);
}

/**
 * Update investigation policy for a tier
 */
export function useUpdateInvestigationPolicy() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.investigation.updatePolicy.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.settings.investigation.getPolicies.key(),
			});
		},
	});
}

/**
 * Fetch investigation limits
 */
export function useInvestigationLimits() {
	return useQuery(
		orpc.settings.investigation.getLimits.queryOptions({
			input: {},
		}),
	);
}

/**
 * Update investigation limits
 */
export function useUpdateInvestigationLimits() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.investigation.updateLimits.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.settings.investigation.getLimits.key(),
			});
		},
	});
}

// =============================================================================
// DANGER ZONE
// =============================================================================

/**
 * Reset all data (alerts, incidents, investigations)
 */
export function useResetData() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.danger.resetData.mutationOptions(),
		onSuccess: () => {
			// Invalidate all queries to refresh data
			queryClient.invalidateQueries();
		},
	});
}

/**
 * Factory reset - delete everything
 */
export function useFactoryReset() {
	return useMutation({
		...orpc.settings.danger.factoryReset.mutationOptions(),
	});
}

// =============================================================================
// MCP SERVER CONFIGURATION
// =============================================================================

/**
 * Query key factory for MCP settings
 */
export const mcpSettingsKeys = {
	settings: () => orpc.settings.mcp.getSettings.key(),
	status: () => orpc.settings.mcp.getStatus.key(),
	serverStatus: (serverId: "github" | "render" | "gitlab") =>
		orpc.settings.mcp.getServerStatus.key({ input: { serverId } }),
};

/**
 * Fetch MCP settings (enabled servers, tool filters, read-only mode)
 */
export function useMcpSettings() {
	return useQuery(
		orpc.settings.mcp.getSettings.queryOptions({
			input: {},
		}),
	);
}

/**
 * Update MCP settings (partial update)
 */
export function useUpdateMcpSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.mcp.updateSettings.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: mcpSettingsKeys.settings() });
			queryClient.invalidateQueries({ queryKey: mcpSettingsKeys.status() });
		},
	});
}

/**
 * Fetch MCP server status (enabled, has credentials, ready)
 */
export function useMcpStatus() {
	return useQuery(
		orpc.settings.mcp.getStatus.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch status of a specific MCP server
 */
export function useMcpServerStatus(serverId: "github" | "render" | "gitlab") {
	return useQuery({
		...orpc.settings.mcp.getServerStatus.queryOptions({
			input: { serverId },
		}),
		enabled: !!serverId,
	});
}

/**
 * Test MCP server connection
 */
export function useTestMcpConnection() {
	return useMutation({
		...orpc.settings.mcp.testConnection.mutationOptions(),
	});
}
