"use client";

import type { InvestigationQuery } from "@prismalens/contracts";
/**
 * Investigation hooks using oRPC client
 *
 * Type-safe hooks for investigation operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for investigations
 */
export const investigationKeys = {
	all: () => orpc.investigations.key(),
	lists: () => orpc.investigations.list.key(),
	list: (filters: Partial<InvestigationQuery>) =>
		orpc.investigations.list.key({ input: filters }),
	detail: (id: string) => orpc.investigations.get.key({ input: { id } }),
	status: (id: string) => orpc.investigations.getStatus.key({ input: { id } }),
	progress: (id: string) =>
		orpc.investigations.getProgress.key({ input: { id } }),
	progressHistory: (id: string) =>
		orpc.investigations.getProgressHistory.key({ input: { id } }),
	byIncident: (incidentId: string) =>
		orpc.investigations.list.key({ input: { incidentId } }),
};

/**
 * Fetch list of investigations with optional filters
 */
/** Default staleTime for investigation data (30 seconds) */
const INVESTIGATION_STALE_TIME = 30_000;

export function useInvestigations(params?: Partial<InvestigationQuery>) {
	return useQuery({
		...orpc.investigations.list.queryOptions({
			input: params ?? {},
		}),
		staleTime: INVESTIGATION_STALE_TIME,
	});
}

/**
 * Fetch a single investigation by ID
 */
export function useInvestigation(id: string) {
	return useQuery({
		...orpc.investigations.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
		staleTime: INVESTIGATION_STALE_TIME,
	});
}

/**
 * Fetch investigation status with polling
 */
export function useInvestigationStatus(
	id: string,
	options?: { refetchInterval?: number },
) {
	return useQuery({
		...orpc.investigations.getStatus.queryOptions({
			input: { id },
		}),
		enabled: !!id,
		staleTime: 5_000, // Shorter staleTime for status (frequently polled)
		refetchInterval: options?.refetchInterval,
	});
}

/**
 * Fetch investigations for a specific incident
 */
export function useInvestigationsByIncident(incidentId: string) {
	return useQuery({
		...orpc.investigations.list.queryOptions({
			input: { incidentId },
		}),
		enabled: !!incidentId,
		staleTime: INVESTIGATION_STALE_TIME,
	});
}

/**
 * Create (start) a new investigation
 */
export function useCreateInvestigation() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.investigations.create.mutationOptions(),
		onSuccess: (investigation) => {
			queryClient.invalidateQueries({ queryKey: investigationKeys.lists() });
			if (investigation.incidentId) {
				queryClient.invalidateQueries({
					queryKey: investigationKeys.byIncident(investigation.incidentId),
				});
			}
		},
	});
}

/**
 * Cancel an investigation
 */
export function useCancelInvestigation() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.investigations.cancel.mutationOptions(),
		onSuccess: (investigation) => {
			queryClient.invalidateQueries({ queryKey: investigationKeys.lists() });
			queryClient.setQueryData(
				investigationKeys.detail(investigation.id),
				investigation,
			);
		},
	});
}

/**
 * Fetch investigation progress from LangGraph checkpoints.
 * Polls while investigation is active, stops when completed/failed.
 *
 * @param id Investigation ID
 * @param options.enabled Whether to enable the query (default: true)
 * @param options.pollingInterval Polling interval in ms (default: 2000)
 */
export function useInvestigationProgress(
	id: string,
	options?: { enabled?: boolean; pollingInterval?: number },
) {
	return useQuery({
		...orpc.investigations.getProgress.queryOptions({
			input: { id },
		}),
		enabled: (options?.enabled ?? true) && !!id,
		refetchInterval: (query) => {
			// Stop polling when investigation completes
			const status = query.state.data?.status;
			if (status === "completed" || status === "failed") {
				return false;
			}
			return options?.pollingInterval ?? 2000;
		},
	});
}

/**
 * Fetch investigation progress history (all checkpoints).
 * Useful for timeline/graph visualization.
 */
export function useInvestigationProgressHistory(
	id: string,
	options?: { enabled?: boolean },
) {
	return useQuery({
		...orpc.investigations.getProgressHistory.queryOptions({
			input: { id },
		}),
		enabled: (options?.enabled ?? true) && !!id,
		staleTime: INVESTIGATION_STALE_TIME,
	});
}
