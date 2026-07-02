"use client";

/**
 * Setup hooks using oRPC client
 *
 * Type-safe hooks for initial setup operations using oRPC with TanStack Query.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for setup
 * Uses oRPC's built-in key generation for consistency
 */
const setupKeys = {
	all: () => orpc.setup.key(),
	status: () => orpc.setup.getStatus.key(),
};

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
