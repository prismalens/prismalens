"use client";

/**
 * Timeline hooks using oRPC client
 *
 * Type-safe hooks for timeline operations using oRPC with TanStack Query.
 */
import type {
	CreateTimelineEntryInput,
	TimelineQuery,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for timeline
 */
export const timelineKeys = {
	all: () => orpc.timeline.key(),
	lists: () => orpc.timeline.list.key(),
	list: (
		incidentId: string,
		filters?: Partial<Omit<TimelineQuery, "incidentId">>,
	) => orpc.timeline.list.key({ input: { incidentId, ...filters } }),
	detail: (id: string) => orpc.timeline.get.key({ input: { id } }),
};

/**
 * Fetch timeline entries for an incident
 */
export function useTimeline(
	incidentId: string,
	params?: Partial<Omit<TimelineQuery, "incidentId">>,
) {
	return useQuery({
		...orpc.timeline.list.queryOptions({
			input: { incidentId, ...params },
		}),
		enabled: !!incidentId,
	});
}

/**
 * Fetch a single timeline entry by ID
 */
export function useTimelineEntry(id: string) {
	return useQuery({
		...orpc.timeline.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create a new timeline entry
 */
export function useCreateTimelineEntry() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.timeline.create.mutationOptions(),
		onSuccess: (entry) => {
			// Invalidate the list for the incident
			queryClient.invalidateQueries({
				queryKey: timelineKeys.list(entry.incidentId),
			});
		},
	});
}

/**
 * Delete a timeline entry
 */
export function useDeleteTimelineEntry() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.timeline.delete.mutationOptions(),
		onSuccess: (_data, variables) => {
			// We need to invalidate lists but we don't have the incidentId
			// So we invalidate all timeline lists
			queryClient.invalidateQueries({
				queryKey: timelineKeys.lists(),
			});
		},
	});
}
