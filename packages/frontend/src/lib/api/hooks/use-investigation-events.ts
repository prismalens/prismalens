// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Replay an investigation's durable canonical event record (ADR-0018).
 *
 * `GET /investigations/:id/events` is seq-cursor paginated (default 100, max 200
 * per page) and never collapses to a single call for a longer investigation, so
 * this loops `nextCursor` to completion before resolving. The record only grows:
 * nothing refetches it whole after the first read; `catchUp` reads past the last
 * seen `seq` and appends (#874).
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { client, orpc } from "../orpc-client";

const EVENTS_PAGE_LIMIT = 200;

export const eventsKey = (id: string) =>
	orpc.investigations.getEvents.key({ input: { id } });

async function fetchEventsAfter(
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

const eventKey = (e: CanonicalEvent) =>
	e.kind === "report" ? `report:${e.seq}` : `${e.branchId}:${e.seq}`;

/** `have` with the events of `more` it lacks, in `seq` order; `have` itself when none are new. */
export function appendEvents(
	have: CanonicalEvent[],
	more: readonly CanonicalEvent[],
): CanonicalEvent[] {
	const seen = new Set(have.map(eventKey));
	const fresh = more.filter((e) => !seen.has(eventKey(e)));
	if (fresh.length === 0) return have;
	return [...have, ...fresh].sort((a, b) => a.seq - b.seq);
}

/**
 * The run's event history, read whole once. `catchUp` appends what was
 * recorded since; `pollMs` repeats it while the live stream cannot deliver.
 */
export function useInvestigationEventsHistory(
	investigationId: string,
	options?: { enabled?: boolean; pollMs?: number | false },
) {
	const queryClient = useQueryClient();
	const enabled = (options?.enabled ?? true) && !!investigationId;
	const query = useQuery({
		queryKey: eventsKey(investigationId),
		queryFn: () => fetchEventsAfter(investigationId, undefined),
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const catchUp = useCallback(async () => {
		const key = eventsKey(investigationId);
		const have = queryClient.getQueryData<CanonicalEvent[]>(key);
		if (!have) return;
		// Seq groups span branches, so the last seq is read again; appendEvents drops what is held.
		const last = have[have.length - 1]?.seq;
		const more = await fetchEventsAfter(
			investigationId,
			last === undefined || last < 1 ? undefined : last - 1,
		);
		queryClient.setQueryData<CanonicalEvent[]>(key, (prev) =>
			prev ? appendEvents(prev, more) : prev,
		);
	}, [investigationId, queryClient]);

	const pollMs = enabled ? (options?.pollMs ?? false) : false;
	useEffect(() => {
		if (!pollMs) return;
		const id = window.setInterval(() => {
			catchUp().catch(() => {});
		}, pollMs);
		return () => window.clearInterval(id);
	}, [pollMs, catchUp]);

	return {
		data: query.data,
		catchUp,
		isLoading: query.isLoading,
		isError: query.isError,
	};
}
