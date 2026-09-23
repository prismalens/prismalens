// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who the browser is to this instance: a paired device or nobody, and whether
 * it manages pairing (`admin:access`, the host's own session). One query,
 * shared by the route gate, the pair page, settings and the sidebar, so they
 * cannot disagree.
 */

import {
	CancelledError,
	type QueryClient,
	useQuery,
} from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";

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
export async function readOperator(queryClient: QueryClient) {
	try {
		return await queryClient.fetchQuery(operatorQueryOptions());
	} catch (error) {
		if (!(error instanceof CancelledError)) throw error;
		return queryClient.fetchQuery(operatorQueryOptions());
	}
}
