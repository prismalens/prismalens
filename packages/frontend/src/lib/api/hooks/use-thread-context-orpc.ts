// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LinkCandidate } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useLiveRefreshInterval } from "../live-refresh";
import { client, orpc } from "../orpc-client";

/** What the right panel shows for one thread (`GET /threads/{id}/context`). */
export function useThreadContext(id: string | null, live = false) {
	const down = useLiveRefreshInterval() !== false;
	return useQuery({
		...orpc.threads.context.queryOptions({ input: { id: id ?? "" } }),
		enabled: !!id,
		// The change stream re-reads it while up; it polls only while the stream is down (#1181).
		refetchInterval: live && down ? 15_000 : false,
	});
}

/** One message's links, resolved once per message (`POST /threads/{id}/links/resolve`). */
export function useResolvedLinks(
	threadId: string | undefined,
	messageKey: string,
	candidates: LinkCandidate[],
	enabled: boolean,
) {
	return useQuery({
		queryKey: ["thread-links", threadId, messageKey],
		queryFn: () =>
			client.threads.resolveLinks({ id: threadId ?? "", candidates }),
		enabled: enabled && !!threadId && candidates.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
