// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Settings hooks using oRPC client
 *
 * Type-safe hooks for LLM configuration operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

// =============================================================================
// COMPREHENSIVE LLM CONFIGURATION
// =============================================================================

/**
 * Query key factory for LLM settings
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
// LLM CREDENTIAL MANAGEMENT
// =============================================================================

/**
 * Query key factory for credential status
 */
export const llmCredentialKeys = {
	status: () => orpc.settings.llm.getCredentialStatus.key(),
};

/**
 * Fetch credential status for all providers
 * Shows which providers have DB keys, env keys, or neither
 */
export function useLlmCredentialStatus() {
	return useQuery(
		orpc.settings.llm.getCredentialStatus.queryOptions({
			input: {},
		}),
	);
}

/**
 * Save an encrypted LLM API key for a provider
 */
export function useSaveLlmCredential() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.llm.saveCredential.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: llmCredentialKeys.status() });
			queryClient.invalidateQueries({ queryKey: llmSettingsKeys.envStatus() });
		},
	});
}

/**
 * Delete an LLM API key for a provider
 */
export function useDeleteLlmCredential() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.llm.deleteCredential.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: llmCredentialKeys.status() });
			queryClient.invalidateQueries({ queryKey: llmSettingsKeys.envStatus() });
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
