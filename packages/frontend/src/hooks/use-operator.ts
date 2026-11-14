// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who the browser is to this instance: a paired device or nobody, and whether
 * it manages pairing (`admin:access`, the host's own session). One query,
 * shared by the route gate, the pair page, settings and the sidebar, so they
 * cannot disagree.
 */

import type { Whoami } from "@prismalens/contracts";
import {
	CancelledError,
	type QueryClient,
	useQuery,
} from "@tanstack/react-query";
import { ConnectionError, orpc } from "@/lib/api/orpc-client";

export const operatorQueryOptions = () => ({
	...orpc.operator.whoami.queryOptions({ input: {} }),
	staleTime: 60_000,
	retry: 1,
});

export function useOperator() {
	const query = useQuery(operatorQueryOptions());
	return {
		...query,
		via: query.data?.via ?? null,
		managesPairing: query.data?.scopes.includes("admin:access") ?? false,
		reason: query.data?.reason ?? null,
	};
}

/**
 * The route gate's read. `fetchQuery` honours staleTime, so a sign-in or a
 * pairing that invalidated the answer is refetched instead of served from
 * the cached null. The request is shared with any mounted `useOperator`
 * observer; when the tree is regenerated after a hydration mismatch that
 * observer unmounts and cancels it, so one cancellation is retried rather
 * than surfaced as a route error.
 */
export async function readOperator(queryClient: QueryClient): Promise<Whoami> {
	// A paired device navigates at once; a stale answer is re-read behind it, so a click
	// that only opens a panel never waits on the link (#1101 category 15 item 1).
	const paired = queryClient.getQueryData<Whoami>(
		operatorQueryOptions().queryKey,
	);
	if (paired?.via) {
		void queryClient.prefetchQuery(operatorQueryOptions());
		return paired;
	}
	try {
		return await queryClient.fetchQuery(operatorQueryOptions());
	} catch (error) {
		// A navigation during a dropped link keeps the device it already knows (#1101 category 12).
		const known = queryClient.getQueryData<Whoami>(
			operatorQueryOptions().queryKey,
		);
		if (error instanceof ConnectionError && known) return known;
		if (!(error instanceof CancelledError)) throw error;
		return queryClient.fetchQuery(operatorQueryOptions());
	}
}
