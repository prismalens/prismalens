// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useLiveRefreshInterval } from "../live-refresh";
import { orpc } from "../orpc-client";

/** A thread's PR subscriptions, newest first; ended ones stay 7 days. */
export function usePrSubscriptions(threadId: string | null, prId?: string) {
	const refetchInterval = useLiveRefreshInterval();
	return useQuery({
		...orpc.prSubscriptions.list.queryOptions({
			input: { id: threadId ?? "", ...(prId ? { prId } : {}) },
		}),
		enabled: !!threadId,
		refetchInterval,
	});
}

/** Start, resume, cancel, retry and read now; each re-reads the list after. */
export function usePrSubscriptionActions(threadId: string | null) {
	const queryClient = useQueryClient();
	const settle = useCallback(
		() =>
			queryClient.invalidateQueries({
				queryKey: orpc.prSubscriptions.key(),
			}),
		[queryClient],
	);
	const create = useMutation(
		orpc.prSubscriptions.create.mutationOptions({ onSettled: settle }),
	);
	const cancel = useMutation(
		orpc.prSubscriptions.cancel.mutationOptions({ onSettled: settle }),
	);
	const retry = useMutation(
		orpc.prSubscriptions.retry.mutationOptions({ onSettled: settle }),
	);
	const poll = useMutation(
		orpc.prSubscriptions.poll.mutationOptions({ onSettled: settle }),
	);
	const id = threadId ?? "";
	const failed = [create, cancel, retry, poll].find((m) => m.isError)?.error;
	return {
		start: (prId: string) => create.mutateAsync({ id, prId }),
		resume: (prId: string, fromId: string) =>
			create.mutateAsync({ id, prId, fromId }),
		cancel: (subscriptionId: string) =>
			cancel.mutateAsync({ id, subscriptionId }),
		retry: () => retry.mutateAsync({ id }),
		poll: () => poll.mutateAsync({ id }),
		busy:
			create.isPending || cancel.isPending || retry.isPending || poll.isPending,
		polling: poll.isPending,
		error: failed instanceof Error ? failed.message : null,
	};
}
