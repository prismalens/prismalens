// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { AlertQuery } from "@prismalens/contracts";
/**
 * Alert hooks using oRPC client
 *
 * Type-safe hooks for alert operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for alerts
 * Uses oRPC's built-in key generation for consistency
 */
export const alertKeys = {
	all: () => orpc.alerts.key(),
	lists: () => orpc.alerts.list.key(),
	list: (filters: Partial<AlertQuery>) =>
		orpc.alerts.list.key({ input: filters }),
	details: () => orpc.alerts.key({ type: "query" }),
	detail: (id: string) => orpc.alerts.get.key({ input: { id } }),
	stats: () => orpc.alerts.getStats.key(),
};

/**
 * Fetch list of alerts with optional filters
 */
export function useAlerts(params?: Partial<AlertQuery>) {
	return useQuery(
		orpc.alerts.list.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single alert by ID
 */
export function useAlert(id: string) {
	return useQuery({
		...orpc.alerts.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Fetch alert statistics
 */
export function useAlertStats() {
	return useQuery(orpc.alerts.getStats.queryOptions({ input: {} }));
}

/**
 * Create a new alert
 */
export function useCreateAlert() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alerts.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
			queryClient.invalidateQueries({ queryKey: alertKeys.stats() });
		},
	});
}

/**
 * Update an existing alert
 */
export function useUpdateAlert() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alerts.update.mutationOptions(),
		onSuccess: (alert) => {
			queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
			queryClient.setQueryData(alertKeys.detail(alert.id), alert);
		},
	});
}

/**
 * Delete an alert
 */
export function useDeleteAlert() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alerts.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
			queryClient.invalidateQueries({ queryKey: alertKeys.stats() });
		},
	});
}

/**
 * Acknowledge an alert
 */
export function useAcknowledgeAlert() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alerts.acknowledge.mutationOptions(),
		onSuccess: (alert) => {
			queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
			queryClient.invalidateQueries({ queryKey: alertKeys.stats() });
			queryClient.setQueryData(alertKeys.detail(alert.id), alert);
		},
	});
}

/**
 * Resolve an alert
 */
export function useResolveAlert() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.alerts.resolve.mutationOptions(),
		onSuccess: (alert) => {
			queryClient.invalidateQueries({ queryKey: alertKeys.lists() });
			queryClient.invalidateQueries({ queryKey: alertKeys.stats() });
			queryClient.setQueryData(alertKeys.detail(alert.id), alert);
		},
	});
}
