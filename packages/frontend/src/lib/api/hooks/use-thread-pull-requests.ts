// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PullRequestView } from "@/components/thread/panel/PullRequests";
import { orpc } from "../orpc-client";

/** How often an open panel asks for its PRs; the server reads the host at most once a minute. */
export const PANEL_PR_POLL_MS = 60_000;

/**
 * The panel's PRs with their watches (`GET /threads/{id}/pull-requests`), and Watch
 * or Stop watching. A pushed status writes the row, and the live feed refetches it.
 */
export function usePanelPullRequests(
	threadId: string | null,
	enabled: boolean,
) {
	const queryClient = useQueryClient();
	const query = useQuery({
		...orpc.threads.pullRequests.queryOptions({
			input: { id: threadId ?? "" },
		}),
		enabled: enabled && !!threadId,
		refetchInterval: PANEL_PR_POLL_MS,
	});
	const on = useMutation(orpc.threads.watchPullRequest.mutationOptions());
	const off = useMutation(orpc.threads.unwatchPullRequest.mutationOptions());
	const watch = useCallback(
		(pr: PullRequestView, next: boolean) => {
			if (!threadId) return;
			const input = { id: threadId, prId: pr.id };
			void (next ? on : off)
				.mutateAsync(input)
				.finally(() =>
					queryClient.invalidateQueries({ queryKey: orpc.threads.key() }),
				);
		},
		[threadId, on, off, queryClient],
	);
	return { data: query.data, watch };
}
