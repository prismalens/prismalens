// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { ServiceListQuery } from "@prismalens/contracts";
/**
 * Service hooks using oRPC client
 *
 * Type-safe hooks for service catalog operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for services
 */
export const serviceKeys = {
	all: () => orpc.services.key(),
	lists: () => orpc.services.list.key(),
	list: (filters: Partial<ServiceListQuery>) =>
		orpc.services.list.key({ input: filters }),
	detail: (id: string) => orpc.services.get.key({ input: { id } }),
	topology: (id: string) => orpc.services.getTopology.key({ input: { id } }),
};

/**
 * Fetch list of services with optional filtering and pagination
 */
export function useServices(params?: Partial<ServiceListQuery>) {
	return useQuery(
		orpc.services.list.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single service by ID
 */
export function useService(id: string) {
	return useQuery({
		...orpc.services.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Fetch service topology (upstream and downstream dependencies)
 */
export function useServiceTopology(id: string) {
	return useQuery({
		...orpc.services.getTopology.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create a new service
 */
export function useCreateService() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.services.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}

/**
 * Update an existing service
 */
export function useUpdateService() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.services.update.mutationOptions(),
		onSuccess: (service) => {
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
			// INVALIDATE, don't `setQueryData`: oRPC's `.key()` is a PREFIX key, so a
			// direct write lands on a phantom cache entry and the detail page keeps
			// rendering stale data (#331 — the local-checkout card read the old value
			// after saving). Invalidation matches on the prefix and refetches.
			queryClient.invalidateQueries({
				queryKey: serviceKeys.detail(service.id),
			});
		},
	});
}

/**
 * Check a candidate local checkout path WITHOUT saving it (#331).
 *
 * A mutation rather than a query because it is an explicit operator action —
 * it shells out to `git` on the server, so it must not run on every keystroke.
 * Saving re-validates server-side; this only makes the failure visible earlier.
 */
export function useValidateCheckoutPath() {
	return useMutation(orpc.services.validateCheckoutPath.mutationOptions());
}

/**
 * Delete a service
 */
export function useDeleteService() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.services.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}

/**
 * Add a dependency to a service
 */
export function useAddServiceDependency() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.services.addDependency.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: serviceKeys.detail(variables.id),
			});
			queryClient.invalidateQueries({
				queryKey: serviceKeys.topology(variables.id),
			});
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}

/**
 * Update a dependency's type or criticality
 */
export function useUpdateServiceDependency() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.services.updateDependency.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: serviceKeys.detail(variables.id),
			});
			queryClient.invalidateQueries({
				queryKey: serviceKeys.topology(variables.id),
			});
		},
	});
}

/**
 * Remove a dependency from a service
 */
export function useRemoveServiceDependency() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.services.removeDependency.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: serviceKeys.detail(variables.id),
			});
			queryClient.invalidateQueries({
				queryKey: serviceKeys.topology(variables.id),
			});
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}
