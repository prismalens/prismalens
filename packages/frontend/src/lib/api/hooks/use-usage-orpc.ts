// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageLimits, UsageQuery } from "@prismalens/contracts";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { agentFacts } from "@/lib/agent-facts";
import { orpc } from "../orpc-client";

/** Tokens and cost from the turns agents reported, for one range and scope. */
export function useUsageSummary(query: UsageQuery) {
	return useQuery({
		...orpc.usage.summary.queryOptions({ input: query }),
		placeholderData: keepPreviousData,
		staleTime: 30_000,
	});
}

/** Each agent's usage windows as it last reported them. */
export function useUsageLimits(enabled = true) {
	return useQuery({
		...orpc.usage.limits.queryOptions({ input: {} }),
		enabled,
		staleTime: 30_000,
	});
}

/** A panel that opens reads an agent's limits again once its newest read is this old (#1180). */
export const LIMIT_READ_AFTER_MS = 5 * 60 * 1000;

/**
 * On open, one limit read per agent that has one before a run and whose newest read, kept
 * or failed, is absent or older than five minutes; never twice in one mount.
 */
export function useLimitReadsOnOpen(
	limits: UsageLimits | undefined,
	now: () => number = Date.now,
) {
	const client = useQueryClient();
	const read = useMutation({
		...orpc.usage.readLimits.mutationOptions(),
		onSettled: () =>
			client.invalidateQueries({ queryKey: orpc.usage.limits.key() }),
	});
	const asked = useRef(new Set<string>());
	const mutate = read.mutate;
	useEffect(() => {
		for (const a of limits?.agents ?? []) {
			if (asked.current.has(a.agent)) continue;
			if (!agentFacts(a.agent)?.limitsBeforeRun) continue;
			const newest = Math.max(
				a.checkedAt ? Date.parse(a.checkedAt) : 0,
				a.triedAt ? Date.parse(a.triedAt) : 0,
			);
			if (newest && now() - newest < LIMIT_READ_AFTER_MS) continue;
			asked.current.add(a.agent);
			mutate({ agent: a.agent });
		}
	}, [limits, mutate, now]);
}

/** The person's API prices for models their agents report no cost for (#1180). */
export function useUsagePrices() {
	return useQuery(orpc.usage.prices.queryOptions({ input: {} }));
}

export function useSetUsagePrices() {
	const client = useQueryClient();
	return useMutation({
		...orpc.usage.setPrices.mutationOptions(),
		onSuccess: (data) => {
			client.setQueryData(orpc.usage.prices.queryKey({ input: {} }), data);
			client.invalidateQueries({ queryKey: orpc.usage.summary.key() });
		},
	});
}
