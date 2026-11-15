// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { client, orpc } from "./orpc-client";

const EVENTS_PAGE_LIMIT = 200;

export const eventsKey = (id: string) =>
	orpc.investigations.getEvents.key({ input: { id } });

/** Every stored event after `cursor`, page by page (the endpoint caps a page at 200). */
export async function fetchEventsAfter(
	investigationId: string,
	cursor: number | undefined,
): Promise<CanonicalEvent[]> {
	const events: CanonicalEvent[] = [];
	for (;;) {
		const page = await client.investigations.getEvents({
			id: investigationId,
			cursor,
			limit: EVENTS_PAGE_LIMIT,
		});
		events.push(...page.events);
		if (page.nextCursor === null) break;
		cursor = page.nextCursor;
	}
	return events;
}

/** The history query `useInvestigationEventsHistory` reads, started before its view mounts. */
export function prefetchEventsHistory(
	queryClient: QueryClient,
	investigationId: string,
): Promise<void> {
	return queryClient.prefetchQuery({
		queryKey: eventsKey(investigationId),
		queryFn: () => fetchEventsAfter(investigationId, undefined),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
