// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageQuery } from "@prismalens/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
