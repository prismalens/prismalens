// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { IncidentQuery } from "@prismalens/contracts";
/**
 * Incident hooks using oRPC client
 *
 * Type-safe hooks for incident operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/**
 * Query key factory for incidents
 */
export const incidentKeys = {
	all: () => orpc.incidents.key(),
	lists: () => orpc.incidents.list.key(),
	list: (filters: Partial<IncidentQuery>) =>
		orpc.incidents.list.key({ input: filters }),
	detail: (id: string) => orpc.incidents.get.key({ input: { id } }),
	stats: () => orpc.incidents.getStats.key(),
};

/**
 * Fetch list of incidents with optional filters
 */
export function useIncidents(params?: Partial<IncidentQuery>) {
	return useQuery(
		orpc.incidents.list.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Fetch a single incident by ID
 */
export function useIncident(id: string) {
	return useQuery({
		...orpc.incidents.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}

/**
 * Fetch active incidents
 */
export function useActiveIncidents() {
	return useQuery(
		orpc.incidents.listActive.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch incident statistics
 */
export function useIncidentStats() {
	return useQuery(orpc.incidents.getStats.queryOptions({ input: {} }));
}

/**
 * Create a new incident
 */
export function useCreateIncident() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.incidents.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: incidentKeys.lists() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.stats() });
		},
	});
}

/**
 * Update an existing incident
 */
export function useUpdateIncident() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: (incident) => {
			queryClient.invalidateQueries({ queryKey: incidentKeys.lists() });
			queryClient.setQueryData(incidentKeys.detail(incident.id), incident);
		},
	});
}

/**
 * Resolve an incident
 */
export function useResolveIncident() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.incidents.resolve.mutationOptions(),
		onSuccess: (incident) => {
			queryClient.invalidateQueries({ queryKey: incidentKeys.lists() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.stats() });
			queryClient.setQueryData(incidentKeys.detail(incident.id), incident);
		},
	});
}

/**
 * Investigate an incident
 */
export function useInvestigateIncident() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: incidentKeys.detail(variables.id),
			});
		},
	});
}

/**
 * Add an alert to an incident
 */
export function useAddAlertToIncident() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.incidents.addAlert.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: incidentKeys.detail(variables.id),
			});
		},
	});
}
