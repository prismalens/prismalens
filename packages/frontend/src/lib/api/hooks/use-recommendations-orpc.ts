// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { RecommendationQuery } from "@prismalens/contracts";
/**
 * Recommendation hooks using oRPC client
 *
 * Type-safe hooks for recommendation operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for recommendations
 */
export const recommendationKeys = {
	all: () => orpc.recommendations.key(),
	lists: () => orpc.recommendations.list.key(),
	list: (filters: Partial<RecommendationQuery>) =>
		orpc.recommendations.list.key({ input: filters }),
	detail: (id: string) => orpc.recommendations.get.key({ input: { id } }),
	stats: () => orpc.recommendations.getStats.key(),
	byInvestigation: (investigationId: string) =>
		orpc.recommendations.list.key({ input: { investigationId } }),
};

/**
 * Fetch list of recommendations with optional filters
 */
export function useRecommendations(params?: Partial<RecommendationQuery>) {
	return useQuery(
		orpc.recommendations.list.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single recommendation by ID
 */
export function useRecommendation(id: string) {
	return useQuery({
		...orpc.recommendations.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Fetch recommendations for a specific investigation
 */
export function useRecommendationsByInvestigation(investigationId: string) {
	return useQuery({
		...orpc.recommendations.list.queryOptions({
			input: { investigationId },
		}),
		enabled: !!investigationId,
	});
}

/**
 * Fetch recommendation statistics
 */
export function useRecommendationStats() {
	return useQuery(orpc.recommendations.getStats.queryOptions({ input: {} }));
}

/**
 * Update a recommendation
 */
export function useUpdateRecommendation() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.recommendations.update.mutationOptions(),
		onSuccess: (recommendation) => {
			queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: recommendationKeys.stats() });
			queryClient.setQueryData(
				recommendationKeys.detail(recommendation.id),
				recommendation,
			);
		},
	});
}

/**
 * Complete a recommendation
 */
export function useCompleteRecommendation() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.recommendations.complete.mutationOptions(),
		onSuccess: (recommendation) => {
			queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: recommendationKeys.stats() });
			queryClient.setQueryData(
				recommendationKeys.detail(recommendation.id),
				recommendation,
			);
		},
	});
}

/**
 * Dismiss a recommendation
 */
export function useDismissRecommendation() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.recommendations.dismiss.mutationOptions(),
		onSuccess: (recommendation) => {
			queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: recommendationKeys.stats() });
			queryClient.setQueryData(
				recommendationKeys.detail(recommendation.id),
				recommendation,
			);
		},
	});
}
