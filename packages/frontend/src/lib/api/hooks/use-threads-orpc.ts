// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Project, service and no-subject threads (#1020).
 */
import type { ThreadFeedQuery } from "@prismalens/contracts";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { useLiveRefreshInterval } from "../live-refresh";
import { orpc } from "../orpc-client";

export type ThreadFeedInput = Partial<ThreadFeedQuery>;

export const threadKeys = {
	all: () => orpc.threads.key(),
	lists: () => orpc.threads.list.key(),
};

/** A project's or a service's own threads, newest first. */
export function useThreads(params: {
	repositoryId?: string;
	serviceId?: string;
}) {
	return useQuery({
		...orpc.threads.list.queryOptions({ input: { ...params, limit: 50 } }),
		enabled: !!(params.repositoryId || params.serviceId),
	});
}

/** The first message starts the thread's run. */
export function useStartThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.start.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
		},
	});
}

/** Every thread in its section, a page of units at a time, refetched while anything is live. */
export function useThreadFeed(input: ThreadFeedInput, enabled = true) {
	return useInfiniteQuery({
		...orpc.threads.feed.infiniteOptions({
			input: (cursor: number) => ({ ...input, cursor }),
			initialPageParam: 0,
			getNextPageParam: (last) => last.nextCursor ?? undefined,
		}),
		enabled,
		refetchInterval: useLiveRefreshInterval(),
		placeholderData: (prev) => prev,
	});
}

/** When quiet threads with no incident settle on their own. */
export function useThreadSettings() {
	return useQuery(orpc.threads.getSettings.queryOptions({ input: {} }));
}

export function useUpdateThreadSettings() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.updateSettings.mutationOptions(),
		onSuccess: (next) => {
			queryClient.setQueryData(
				orpc.threads.getSettings.queryKey({ input: {} }),
				next,
			);
			void queryClient.invalidateQueries({ queryKey: orpc.threads.feed.key() });
		},
	});
}

/** The user's name for a thread; the agent never renames it after this. */
export function useRenameThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.rename.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: threadKeys.all() }),
	});
}

export function useSettleThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.settle.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threads.feed.key() }),
	});
}

/**
 * Marks the thread seen when it opens and again when its run ends, so an
 * outcome watched as it landed never waits in Needs you.
 */
export function useVisitThread(id: string | null, ended: boolean) {
	const queryClient = useQueryClient();
	const { mutate } = useMutation({
		...orpc.threads.visit.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threads.feed.key() }),
	});
	useEffect(() => {
		if (id) mutate({ id });
	}, [id, ended, mutate]);
}
