// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Replay a finished investigation's durable canonical event record (ADR-0018).
 *
 * `GET /investigations/:id/events` is seq-cursor paginated (default 100, max 200
 * per page) and never collapses to a single call for a longer investigation, so
 * this loops `nextCursor` to completion before resolving. Pairs with
 * `transformLiveEventsToCanvas`, which does not care whether its events arrived
 * live over SSE or from this replay.
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { client, orpc } from "../orpc-client";

const EVENTS_PAGE_LIMIT = 200;

async function fetchAllEvents(
	investigationId: string,
): Promise<CanonicalEvent[]> {
	const events: CanonicalEvent[] = [];
	let cursor: number | undefined;

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

/**
 * Fetch the full canonical event history for a finished (non-streaming)
 * investigation, for the same canvas transform the live path uses.
 */
export function useInvestigationEventsHistory(
	investigationId: string,
	options?: { enabled?: boolean },
) {
	return useQuery({
		queryKey: orpc.investigations.getEvents.key({
			input: { id: investigationId },
		}),
		queryFn: () => fetchAllEvents(investigationId),
		enabled: (options?.enabled ?? true) && !!investigationId,
	});
}
