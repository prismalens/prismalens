"use client";

/**
 * Setup hooks using oRPC client
 *
 * Type-safe hooks for initial setup operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for setup
 * Uses oRPC's built-in key generation for consistency
 */
export const setupKeys = {
	all: () => orpc.setup.key(),
	status: () => orpc.setup.getStatus.key(),
};

/**
 * Check if initial setup is complete
 */
export function useSetupStatus() {
	return useQuery(
		orpc.setup.getStatus.queryOptions({
			input: {},
		}),
	);
}

/**
 * Create the first admin account during initial setup
 */
export function useCreateOwner() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.setup.createOwner.mutationOptions(),
		onSuccess: () => {
			// Invalidate setup status to reflect the new state
			queryClient.invalidateQueries({ queryKey: setupKeys.status() });
		},
	});
}

/**
 * Mark an optional setup step as skipped
 * Used when user clicks "Skip for now" on LLM or Integrations step
 */
export function useMarkStepSkipped() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.setup.markStepSkipped.mutationOptions(),
		onSuccess: () => {
			// Invalidate setup status to reflect the skipped step
			queryClient.invalidateQueries({ queryKey: setupKeys.status() });
		},
	});
}

/**
 * Fetch LLM env status (public — no auth needed during setup)
 */
export function useSetupLlmEnvStatus() {
	return useQuery(
		orpc.setup.getLlmEnvStatus.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch available LLM models (public — no auth needed during setup)
 */
export function useSetupLlmModels(provider?: string) {
	return useQuery({
		...orpc.setup.getLlmModels.queryOptions({
			input: { provider },
		}),
		staleTime: 24 * 60 * 60 * 1000, // 24 hours
	});
}

/**
 * Save LLM credential (public — no auth needed during setup)
 */
export function useSetupSaveLlmCredential() {
	return useMutation({
		...orpc.setup.saveLlmCredential.mutationOptions(),
	});
}

/**
 * Update LLM settings (public — no auth needed during setup)
 */
export function useSetupUpdateLlmSettings() {
	return useMutation({
		...orpc.setup.updateLlmSettings.mutationOptions(),
	});
}

/**
 * Test LLM connection (public — no auth needed during setup)
 */
export function useSetupTestLlmConnection() {
	return useMutation({
		...orpc.setup.testLlmConnection.mutationOptions(),
	});
}
