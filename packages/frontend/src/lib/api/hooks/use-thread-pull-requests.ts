// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** How often an open panel asks for its PRs; the server reads the host at most once a minute. */
export const PANEL_PR_POLL_MS = 60_000;

/**
 * The panel's PRs (`GET /threads/{id}/pull-requests`). A pushed status writes the row,
 * and the live feed refetches it; subscriptions live in `use-pr-subscriptions` (#1179).
 */
export function usePanelPullRequests(
	threadId: string | null,
	enabled: boolean,
) {
	const query = useQuery({
		...orpc.threads.pullRequests.queryOptions({
			input: { id: threadId ?? "" },
		}),
		enabled: enabled && !!threadId,
		refetchInterval: PANEL_PR_POLL_MS,
	});
	return { data: query.data };
}
