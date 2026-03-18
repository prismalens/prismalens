"use client";

/**
 * Repository hooks using oRPC client
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";
import { serviceKeys } from "./use-services-orpc";

export const repositoryKeys = {
	all: () => orpc.repositories.key(),
	lists: () => orpc.repositories.list.key(),
	list: (params?: { connectionId?: string; search?: string }) =>
		orpc.repositories.list.key({ input: params ?? {} }),
	detail: (id: string) => orpc.repositories.get.key({ input: { id } }),
};

/**
 * Fetch list of repositories
 */
export function useRepositories(params?: {
	connectionId?: string;
	search?: string;
	limit?: number;
	offset?: number;
	enabled?: boolean;
}) {
	const { enabled = true, ...input } = params ?? {};
	return useQuery({
		...orpc.repositories.list.queryOptions({
			input,
		}),
		enabled,
	});
}

/**
 * Fetch count of unlinked repositories
 */
export function useUnlinkedRepositoryCount() {
	return useQuery(
		orpc.repositories.unlinkedCount.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch a single repository by ID
 */
export function useRepository(id: string) {
	return useQuery({
		...orpc.repositories.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Batch create repositories
 */
export function useBatchCreateRepositories() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.repositories.batchCreate.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
		},
	});
}

/**
 * Link a repository to a service
 */
export function useLinkRepository() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.repositories.link.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
			queryClient.invalidateQueries({
				queryKey: serviceKeys.detail(variables.serviceId),
			});
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}

/**
 * Unlink a repository from a service
 */
export function useUnlinkRepository() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.repositories.unlink.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
			queryClient.invalidateQueries({
				queryKey: serviceKeys.detail(variables.serviceId),
			});
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}

/**
 * Delete an unlinked repository
 */
export function useDeleteRepository() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.repositories.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}
