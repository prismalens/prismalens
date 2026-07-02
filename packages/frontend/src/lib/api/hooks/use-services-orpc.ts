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
			queryClient.setQueryData(serviceKeys.detail(service.id), service);
		},
	});
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
