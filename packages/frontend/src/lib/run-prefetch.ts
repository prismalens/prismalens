// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { QueryClient } from "@tanstack/react-query";
import { openRun } from "@/components/incidents/run-facts";
import { prefetchEventsHistory } from "@/lib/api/events-history";
import { orpc } from "@/lib/api/orpc-client";

/**
 * A run page's record, run and history, started as its route matches rather than one round
 * trip after another behind its code (#1130). The run is the URL's, else the layout's pick.
 */
export async function prefetchRun(
	queryClient: QueryClient,
	incidentId: string,
	investigation?: string,
): Promise<void> {
	const run = (id: string) =>
		Promise.all([
			queryClient.prefetchQuery(
				orpc.investigations.get.queryOptions({ input: { id } }),
			),
			prefetchEventsHistory(queryClient, id),
		]);
	const incident = queryClient.fetchQuery(
		orpc.incidents.get.queryOptions({ input: { id: incidentId } }),
	);
	if (investigation) {
		await Promise.all([incident, run(investigation)]);
		return;
	}
	const picked = openRun((await incident).investigations ?? [], false)?.id;
	if (picked) await run(picked);
}
