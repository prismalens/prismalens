// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Postmortem hooks using oRPC client
 *
 * Type-safe hooks for postmortem operations using oRPC with TanStack Query.
 */
import type {
	CreatePostmortemInput,
	UpdatePostmortemInput,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for postmortems
 */
export const postmortemKeys = {
	all: () => orpc.postmortems.key(),
	byIncident: (incidentId: string) =>
		orpc.postmortems.getByIncidentId.key({ input: { incidentId } }),
	detail: (id: string) => orpc.postmortems.get.key({ input: { id } }),
};

/**
 * Fetch postmortem by incident ID
 */
export function usePostmortemByIncident(incidentId: string) {
	return useQuery({
		...orpc.postmortems.getByIncidentId.queryOptions({
			input: { incidentId },
		}),
		enabled: !!incidentId,
	});
}

/**
 * Fetch a single postmortem by ID
 */
export function usePostmortem(id: string) {
	return useQuery({
		...orpc.postmortems.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create a new postmortem
 */
export function useCreatePostmortem() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.postmortems.create.mutationOptions(),
		onSuccess: (postmortem) => {
			// Invalidate queries
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.byIncident(postmortem.incidentId),
			});
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.all(),
			});
		},
	});
}

/**
 * Update a postmortem
 */
export function useUpdatePostmortem() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.postmortems.update.mutationOptions(),
		onSuccess: (postmortem) => {
			// Invalidate queries
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.detail(postmortem.id),
			});
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.byIncident(postmortem.incidentId),
			});
		},
	});
}

/**
 * Publish a postmortem
 */
export function usePublishPostmortem() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.postmortems.publish.mutationOptions(),
		onSuccess: (postmortem) => {
			// Invalidate queries
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.detail(postmortem.id),
			});
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.byIncident(postmortem.incidentId),
			});
		},
	});
}

/**
 * Delete a postmortem
 */
export function useDeletePostmortem() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.postmortems.delete.mutationOptions(),
		onSuccess: () => {
			// Invalidate all postmortem queries
			queryClient.invalidateQueries({
				queryKey: postmortemKeys.all(),
			});
		},
	});
}
