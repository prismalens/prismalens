// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useLiveRefreshInterval } from "../live-refresh";
import { orpc } from "../orpc-client";

/** An event that changes what a thread's subscription list shows (#1179). */
export function touchesPrSubscriptions(e: CanonicalEvent): boolean {
	return (
		e.kind === "pr_subscription" ||
		e.kind === "message_received" ||
		(e.kind === "message_inbound" && e.source === "pr")
	);
}

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

/** Re-reads the list when the record says a subscription, receipt or PR bundle moved. */
export function usePrSubscriptionsRefresh(events: readonly CanonicalEvent[]) {
	const queryClient = useQueryClient();
	let seq: number | null = null;
	const floor = Math.max(0, events.length - 500);
	for (let i = events.length - 1; i >= floor && seq === null; i--)
		if (touchesPrSubscriptions(events[i])) seq = events[i].seq;
	useEffect(() => {
		if (seq === null) return;
		void queryClient.invalidateQueries({
			queryKey: orpc.prSubscriptions.key(),
		});
	}, [seq, queryClient]);
}
