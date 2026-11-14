// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { InvestigationQuery, ThreadAsks } from "@prismalens/contracts";
/**
 * Investigation hooks using oRPC client
 *
 * Type-safe hooks for investigation operations using oRPC with TanStack Query.
 */
import {
	type QueryClient,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { orpc } from "../orpc-client";
import { incidentKeys } from "./use-incidents-orpc";

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

/** Take up a run a restart cut off and PrismaLens did not resume (#981): 409 when it was not interrupted or is live. */
export function useResumeInvestigation() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.investigations.resume.mutationOptions(),
		onSuccess: (investigation) => {
			queryClient.invalidateQueries({
				queryKey: investigationKeys.detail(investigation.id),
			});
			queryClient.invalidateQueries({ queryKey: investigationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
		},
	});
}

/** What the last start did with the runs a stop cut off (#981); read once per load. */
export function useRestartSummary() {
	return useQuery({
		...orpc.investigations.restartSummary.queryOptions({ input: {} }),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
}

/** Send the operator's message to a live run (#743): 202 queued or sent, 409 once it ended. */
export function useSendInvestigationMessage() {
	return useMutation(orpc.investigations.message.mutationOptions());
}

/** The operator's Approve or Deny for the agent's ask (#673 w21): 409 once it no longer waits. */
/** An answer leaves every list at once: the row, the count and the thread (#1101 cat 8 item 3). */
export function useAnswerAsk() {
	const client = useQueryClient();
	const asksKey = orpc.threads.asks.queryKey({ input: {} });
	return useMutation({
		...orpc.investigations.answerAsk.mutationOptions(),
		onMutate: async ({ askId }) => {
			await client.cancelQueries({ queryKey: asksKey });
			const before = client.getQueryData<ThreadAsks>(asksKey);
			if (before)
				client.setQueryData<ThreadAsks>(asksKey, {
					asks: before.asks.filter((a) => a.ask.askId !== askId),
				});
			return { before };
		},
		onError: (_e, _v, ctx) => {
			if (ctx?.before) client.setQueryData(asksKey, ctx.before);
		},
		onSettled: () => client.invalidateQueries({ queryKey: orpc.threads.key() }),
	});
}

/** How long this device's own answer outranks a status the server has not re-read yet. */
const ANSWERED_HERE_MS = 60_000;

export interface AnsweredHere {
	threadId: string;
	askId: string;
}

/**
 * Asks this device answered in the last minute, read from the answer calls themselves,
 * so the row, the dock, the phone card and the header agree on who answered (#1101 cat 8).
 */
export function useAnsweredHere(): readonly AnsweredHere[] {
	const all = useMutationState({
		filters: { mutationKey: orpc.investigations.answerAsk.mutationKey() },
		select: (m) => ({
			status: m.state.status,
			at: m.state.submittedAt,
			vars: m.state.variables as { id?: string; askId?: string } | undefined,
		}),
	});
	const now = Date.now();
	const list = all.flatMap((m) =>
		m.status !== "error" &&
		m.vars?.id &&
		m.vars.askId &&
		now - m.at < ANSWERED_HERE_MS
			? [{ threadId: m.vars.id, askId: m.vars.askId }]
			: [],
	);
	// One array per set of asks, so a list built from it re-sorts only when it changes.
	const kept = useRef(list);
	const key = (l: readonly AnsweredHere[]) => l.map((a) => a.askId).join();
	if (key(kept.current) !== key(list)) kept.current = list;
	return kept.current;
}

/** Hand a run the secret it asked for (#1024): write-only, the value never comes back. */
export function useAnswerSecret() {
	return useMutation(orpc.investigations.answerSecret.mutationOptions());
}

/** Change a queued message's text before the agent reads it (#1024). */
export function useEditQueuedMessage() {
	return useMutation(orpc.investigations.editMessage.mutationOptions());
}

/** Take back a queued message before the agent reads it (#1024). */
export function useWithdrawQueuedMessage() {
	return useMutation(orpc.investigations.withdrawMessage.mutationOptions());
}

/** `/compact`: the agent's own compaction on a paused thread (#1024). */
export function useCompactThread(client: QueryClient) {
	return useMutation(
		{
			...orpc.investigations.compact.mutationOptions(),
			onSuccess: (_d, v) =>
				client.invalidateQueries({
					queryKey: investigationKeys.detail(v.id),
				}),
		},
		client,
	);
}
