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
