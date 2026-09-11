// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Settings hooks using oRPC client
 *
 * Type-safe hooks for settings operations using oRPC with TanStack Query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

// =============================================================================
// HARNESS STATUS
// =============================================================================

/**
 * Query key factory for harness auth status
 */
export const harnessKeys = {
	status: () => orpc.settings.harnesses.getHarnesses.key(),
	settings: () => orpc.settings.harnesses.getSettings.key(),
};

/**
 * Fetch per-harness auth verdicts (ADR-0031). The server resolves these from
 * local machine evidence — key presence, binary on PATH, session file — so the
 * verdicts move with the machine, not with the app (#501).
 */
export function useHarnesses() {
	return useQuery(
		orpc.settings.harnesses.getHarnesses.queryOptions({
			input: {},
		}),
	);
}

/**
 * Fetch the persisted harness choice and model (`GET /settings/harness`).
 * `PRISMALENS_HARNESS`, when set, overrides this — `useHarnesses`' `selection`
 * carries that verdict, never this hook.
 */
export function useHarnessSettings() {
	return useQuery(
		orpc.settings.harnesses.getSettings.queryOptions({
			input: {},
		}),
	);
}

/**
 * Persist the harness choice and/or model (`PATCH /settings/harness`).
 * Invalidates both the settings echo and the selection verdict — a saved
 * harness changes whether an investigation would start right now.
 */
export function useUpdateHarnessSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.harnesses.updateSettings.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: harnessKeys.settings() });
			queryClient.invalidateQueries({ queryKey: harnessKeys.status() });
		},
	});
}

export interface InvestigationReadiness {
	/** Would an investigation start right now? */
	isReady: boolean;
	/** Why it would not, worded by the server's gate. Undefined when ready. */
	blockedReason: string | undefined;
	isLoading: boolean;
}

/**
 * The ONE client-side answer to "can an investigation run, and if not why" —
 * the server's gate verdict for the current selection, never re-derived here.
 * Deriving it from `activeProvider` or `harnesses.some(runnable)` is #521.
 */
export function useInvestigationReadiness(): InvestigationReadiness {
	const { data, isLoading, isError } = useHarnesses();
	const selection = data?.selection;

	if (selection?.runnable) {
		return { isReady: true, blockedReason: undefined, isLoading: false };
	}

	const fallback = isLoading
		? "Checking whether a coding agent is usable…"
		: isError
			? "Could not check agent status — retry from Settings → Harness."
			: "No coding agent is available — see Settings → Harness.";

	return {
		isReady: false,
		blockedReason: selection?.blockedReason ?? fallback,
		isLoading,
	};
}

// =============================================================================
// INVESTIGATION POLICIES
// =============================================================================

/**
 * Fetch investigation policies for all tiers
 */
export function useInvestigationPolicies() {
	return useQuery(
		orpc.settings.investigation.getPolicies.queryOptions({
			input: {},
		}),
	);
}

/**
 * Update investigation policy for a tier
 */
export function useUpdateInvestigationPolicy() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.investigation.updatePolicy.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.settings.investigation.getPolicies.key(),
			});
		},
	});
}

/**
 * Fetch investigation limits
 */
export function useInvestigationLimits() {
	return useQuery(
		orpc.settings.investigation.getLimits.queryOptions({
			input: {},
		}),
	);
}

/**
 * Update investigation limits
 */
export function useUpdateInvestigationLimits() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.investigation.updateLimits.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.settings.investigation.getLimits.key(),
			});
		},
	});
}

// =============================================================================
// DANGER ZONE
// =============================================================================

/**
 * Reset all data (alerts, incidents, investigations)
 */
export function useResetData() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.settings.danger.resetData.mutationOptions(),
		onSuccess: () => {
			// Invalidate all queries to refresh data
			queryClient.invalidateQueries();
		},
	});
}

/**
 * Factory reset - delete everything
 */
export function useFactoryReset() {
	return useMutation({
		...orpc.settings.danger.factoryReset.mutationOptions(),
	});
}
