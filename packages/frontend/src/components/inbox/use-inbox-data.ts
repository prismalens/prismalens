// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentQuery,
	IncidentWithRelations,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { client, orpc } from "@/lib/api/orpc-client";
import { groupNeeds } from "./inbox-model";

type ListInput = Partial<IncidentQuery>;

/** One list query, every page: the API caps a page at 100 rows, not the list. */
function allPages(input: ListInput) {
	return {
		...orpc.incidents.list.queryOptions({ input }),
		queryFn: async ({ signal }: { signal?: AbortSignal }) => {
			const first = await client.incidents.list(input, { signal });
			const data = [...first.data];
			let page = first;
			while (page.pagination.hasMore) {
				page = await client.incidents.list(
					{ ...input, offset: data.length },
					{ signal },
				);
				if (page.data.length === 0) break;
				data.push(...page.data);
			}
			return { ...first, data };
		},
	};
}

/**
 * Every incident that is not resolved by you: the open ones and those whose
 * alerts cleared. The inbox, the sidebar and the nav count read this one list.
 */
export function useActiveIncidents(enabled = true) {
	const interval = useLiveRefreshInterval();
	const open = useQuery({
		...allPages({ open: true, limit: 100 }),
		refetchInterval: interval,
		enabled,
	});
	const cleared = useQuery({
		...allPages({ status: "resolved", limit: 100 }),
		refetchInterval: interval,
		enabled,
	});
	const incidents = useMemo<IncidentWithRelations[]>(
		() => [...(open.data?.data ?? []), ...(cleared.data?.data ?? [])],
		[open.data, cleared.data],
	);
	return {
		incidents,
		isLoading: open.isLoading || cleared.isLoading,
		error: open.error ?? cleared.error,
		refetch: () => {
			void open.refetch();
			void cleared.refetch();
		},
	};
}

/** How many incidents need you, for the Incidents door; undefined while loading. */
export function useNeedsYouCount(enabled = true): number | undefined {
	const { incidents, isLoading } = useActiveIncidents(enabled);
	return useMemo(
		() =>
			isLoading
				? undefined
				: groupNeeds(incidents).reduce((n, g) => n + g.rows.length, 0),
		[incidents, isLoading],
	);
}

const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);

/** Incidents you resolved, newest first. */
export function useRecentlyResolved(limit = 5) {
	const { data, isLoading } = useQuery({
		...orpc.incidents.list.queryOptions({
			input: { status: "closed", limit: 50 },
		}),
		refetchInterval: useLiveRefreshInterval(),
	});
	const rows = useMemo(
		() =>
			[...(data?.data ?? [])]
				.sort(
					(a, b) =>
						time(b.closedAt ?? b.updatedAt) - time(a.closedAt ?? a.updatedAt),
				)
				.slice(0, limit),
		[data, limit],
	);
	return { rows, isLoading };
}
