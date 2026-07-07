// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Deployment hooks using oRPC client
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";
import { serviceKeys } from "./use-services-orpc";

export const deploymentKeys = {
	all: () => orpc.deployments.key(),
	lists: () => orpc.deployments.list.key(),
	list: (params?: {
		connectionId?: string;
		serviceId?: string;
		search?: string;
	}) => orpc.deployments.list.key({ input: params ?? {} }),
	detail: (id: string) => orpc.deployments.get.key({ input: { id } }),
};

/**
 * Fetch list of deployments
 */
export function useDeployments(params?: {
	connectionId?: string;
	serviceId?: string;
	search?: string;
	limit?: number;
	offset?: number;
	enabled?: boolean;
}) {
	const { enabled = true, ...input } = params ?? {};
	return useQuery({
		...orpc.deployments.list.queryOptions({
			input,
		}),
		enabled,
	});
}

/**
 * Fetch count of unlinked deployments
 */
export function useUnlinkedDeploymentCount() {
	return useQuery(
		orpc.deployments.unlinkedCount.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch a single deployment by ID
 */
export function useDeployment(id: string) {
	return useQuery({
		...orpc.deployments.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Batch create deployments
 */
export function useBatchCreateDeployments() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.deployments.batchCreate.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
		},
	});
}

/**
 * Link a deployment to a service
 */
export function useLinkDeployment() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.deployments.link.mutationOptions(),
		onSuccess: (deployment) => {
			queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
			if (deployment.serviceId) {
				queryClient.invalidateQueries({
					queryKey: serviceKeys.detail(deployment.serviceId),
				});
			}
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}

/**
 * Unlink a deployment from its service
 */
export function useUnlinkDeployment() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.deployments.unlink.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
			queryClient.invalidateQueries({ queryKey: serviceKeys.all() });
		},
	});
}

/**
 * Delete an unlinked deployment
 */
export function useDeleteDeployment() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.deployments.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
			queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
		},
	});
}
