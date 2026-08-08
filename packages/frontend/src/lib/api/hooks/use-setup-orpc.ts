// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
 * Which on-ramp steps are done, and which step the wizard resumes on (#332).
 *
 * Server-derived on every read, so it is also the source of truth for the
 * "what is still missing" hints that empty states show. Public route — safe to
 * call from an unauthenticated surface.
 */
export function useSetupStatus() {
	return useQuery({
		...orpc.setup.getStatus.queryOptions({ input: {} }),
		// The status changes as a side effect of actions on OTHER screens
		// (saving a key, mapping a checkout), so a long cache would show a
		// stale "still missing" nag.
		staleTime: 10_000,
	});
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
