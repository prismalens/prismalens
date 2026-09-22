// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who the browser is to this instance. `via` is `loopback` on the host
 * itself, `session` when signed in, null otherwise. One query, shared by the
 * route gate, the login page and the sidebar, so they cannot disagree.
 */

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";

export const operatorQueryOptions = () => ({
	...orpc.operator.whoami.queryOptions({ input: {} }),
	staleTime: 60_000,
	retry: 1,
});

export function useOperator() {
	const query = useQuery(operatorQueryOptions());
	return { ...query, via: query.data?.via ?? null };
}
