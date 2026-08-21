// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { AlertMappingQuery } from "@prismalens/contracts";
/**
 * Alert mapping rule hooks using oRPC client
 *
 * Type-safe hooks for alert-mapping rule CRUD and the mapping-evaluation test
 * endpoint, backing the `/rules` screen (#294).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for alert mapping rules
 * Uses oRPC's built-in key generation for consistency
 */
export const alertMappingKeys = {
	all: () => orpc.alertMapping.key(),
	lists: () => orpc.alertMapping.list.key(),
	list: (filters: Partial<AlertMappingQuery>) =>
		orpc.alertMapping.list.key({ input: filters }),
	details: () => orpc.alertMapping.key({ type: "query" }),
	detail: (id: string) => orpc.alertMapping.get.key({ input: { id } }),
};

/**
 * Fetch alert mapping rules
 */
export function useAlertMappingRules(params?: Partial<AlertMappingQuery>) {
	return useQuery(
		orpc.alertMapping.list.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single alert mapping rule by ID
 */
export function useAlertMappingRule(id: string) {
	return useQuery({
		...orpc.alertMapping.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Create an alert mapping rule
 */
export function useCreateAlertMappingRule() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alertMapping.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: alertMappingKeys.lists() });
		},
	});
}

/**
 * Update an alert mapping rule
 */
export function useUpdateAlertMappingRule() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alertMapping.update.mutationOptions(),
		onSuccess: (rule) => {
			queryClient.invalidateQueries({ queryKey: alertMappingKeys.lists() });
			queryClient.setQueryData(alertMappingKeys.detail(rule.id), rule);
		},
	});
}

/**
 * Delete an alert mapping rule
 */
export function useDeleteAlertMappingRule() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alertMapping.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: alertMappingKeys.lists() });
		},
	});
}

/**
 * Evaluate a sample alert against the saved, enabled mapping rules.
 * Read-only on the server, so nothing is invalidated here.
 */
export function useTestAlertMapping() {
	return useMutation(orpc.alertMapping.test.mutationOptions());
}
