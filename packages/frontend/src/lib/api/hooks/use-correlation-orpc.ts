// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { CorrelationRuleQuery } from "@prismalens/contracts";
/**
 * Correlation rule hooks using oRPC client
 *
 * Type-safe hooks for correlation rule CRUD and the rule-evaluation test
 * endpoint, backing the `/rules` screen (#294).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for correlation rules
 * Uses oRPC's built-in key generation for consistency
 */
export const correlationKeys = {
	all: () => orpc.correlation.key(),
	lists: () => orpc.correlation.list.key(),
	list: (filters: Partial<CorrelationRuleQuery>) =>
		orpc.correlation.list.key({ input: filters }),
	details: () => orpc.correlation.key({ type: "query" }),
	detail: (id: string) => orpc.correlation.get.key({ input: { id } }),
};

/**
 * Fetch correlation rules
 */
export function useCorrelationRules(params?: Partial<CorrelationRuleQuery>) {
	return useQuery(
		orpc.correlation.list.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single correlation rule by ID
 */
export function useCorrelationRule(id: string) {
	return useQuery({
		...orpc.correlation.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create a correlation rule
 */
export function useCreateCorrelationRule() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.correlation.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: correlationKeys.lists() });
		},
	});
}

/**
 * Update a correlation rule
 */
export function useUpdateCorrelationRule() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.correlation.update.mutationOptions(),
		onSuccess: (rule) => {
			queryClient.invalidateQueries({ queryKey: correlationKeys.lists() });
			queryClient.setQueryData(correlationKeys.detail(rule.id), rule);
		},
	});
}

/**
 * Delete a correlation rule
 */
export function useDeleteCorrelationRule() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.correlation.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: correlationKeys.lists() });
		},
	});
}

/**
 * Evaluate a sample alert against the saved, enabled correlation rules.
 * Read-only on the server, so nothing is invalidated here.
 */
export function useTestCorrelation() {
	return useMutation(orpc.correlation.test.mutationOptions());
}
