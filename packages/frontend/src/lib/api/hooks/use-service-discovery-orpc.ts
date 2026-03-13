"use client";

/**
 * Service discovery hooks using oRPC client
 *
 * Hooks for triggering discovery, managing suggestions, and bulk operations.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceType, SuggestionStatus } from "@prismalens/contracts";
import { orpc } from "../orpc-client";
import { serviceKeys } from "./use-services-orpc";

interface SuggestionListParams {
	connectionId?: string;
	status?: SuggestionStatus;
	sourceType?: SourceType;
	limit?: number;
	offset?: number;
}

/**
 * Query key factory for service discovery
 */
export const serviceDiscoveryKeys = {
	all: () => orpc.serviceDiscovery.key(),
	suggestions: {
		all: () => orpc.serviceDiscovery.listSuggestions.key(),
		list: (params?: SuggestionListParams) =>
			orpc.serviceDiscovery.listSuggestions.key({ input: params ?? {} }),
		detail: (id: string) =>
			orpc.serviceDiscovery.getSuggestion.key({ input: { id } }),
	},
};

/**
 * Fetch pending service suggestions
 */
export function useSuggestions(params?: SuggestionListParams) {
	return useQuery(
		orpc.serviceDiscovery.listSuggestions.queryOptions({
			input: params ?? {},
		}),
	);
}

/**
 * Trigger service discovery for a connection
 */
export function useTriggerDiscovery() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.serviceDiscovery.triggerDiscovery.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: serviceDiscoveryKeys.suggestions.all(),
			});
			queryClient.invalidateQueries({
				queryKey: serviceKeys.lists(),
			});
		},
	});
}

/**
 * Accept a single service suggestion
 */
export function useAcceptSuggestion() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.serviceDiscovery.acceptSuggestion.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: serviceDiscoveryKeys.suggestions.all(),
			});
			queryClient.invalidateQueries({
				queryKey: serviceKeys.lists(),
			});
		},
	});
}

/**
 * Reject a service suggestion
 */
export function useRejectSuggestion() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.serviceDiscovery.rejectSuggestion.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: serviceDiscoveryKeys.suggestions.all(),
			});
		},
	});
}

/**
 * Ignore a service suggestion (permanently hidden)
 */
export function useIgnoreSuggestion() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.serviceDiscovery.ignoreSuggestion.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: serviceDiscoveryKeys.suggestions.all(),
			});
		},
	});
}

/**
 * Accept multiple suggestions at once
 */
export function useAcceptBulkSuggestions() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.serviceDiscovery.acceptBulkSuggestions.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: serviceDiscoveryKeys.suggestions.all(),
			});
			queryClient.invalidateQueries({
				queryKey: serviceKeys.lists(),
			});
		},
	});
}
