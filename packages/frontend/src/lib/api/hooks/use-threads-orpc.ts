// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Project, service and no-subject threads (#1020).
 */
import type {
	ThreadFeed,
	ThreadFeedQuery,
	ThreadRow,
} from "@prismalens/contracts";
import {
	MutationObserver,
	partialMatchKey,
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { useTabVisible } from "@/lib/attention/use-attention";
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
		onSettled: () => refreshThreads(queryClient),
	});
}

/**
 * Marks the thread seen when it opens and again when its run ends, so an
 * outcome watched as it landed never waits in Needs you. A background tab
 * marks nothing until it is shown (#1101 category 3).
 */
export function useVisitThread(id: string | null, ended: boolean) {
	const queryClient = useQueryClient();
	const visible = useTabVisible();
	const { mutate } = useMutation({
		...orpc.threads.visit.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threads.feed.key() }),
	});
	useEffect(() => {
		if (id && visible) mutate({ id });
	}, [id, ended, visible, mutate]);
}

/** Every open ask across threads, for answering from the list (#1101 category 8). */
export function useThreadAsks(enabled = true) {
	return useQuery({
		...orpc.threads.asks.queryOptions({ input: {} }),
		enabled,
		refetchInterval: useLiveRefreshInterval(),
	});
}

const refreshThreads = (queryClient: ReturnType<typeof useQueryClient>) =>
	queryClient.invalidateQueries({ queryKey: threadKeys.all() });

/**
 * Pin, Archive and "Name it again" for a thread menu, built when picked: every list row holds a
 * menu, and a mutation hook per row was a share of the first frame (#1130).
 */
export const threadMenuMutations = {
	pin: (queryClient: QueryClient) =>
		new MutationObserver(queryClient, {
			...orpc.threads.pin.mutationOptions(),
			onSettled: () => refreshThreads(queryClient),
		}),
	archive: (queryClient: QueryClient) =>
		new MutationObserver(queryClient, {
			...orpc.threads.archive.mutationOptions(),
			onSettled: () => refreshThreads(queryClient),
		}),
	nameAgain: (queryClient: QueryClient) =>
		new MutationObserver(queryClient, {
			...orpc.threads.regenerateTitle.mutationOptions(),
			onSettled: () => refreshThreads(queryClient),
		}),
};

/** Fork here or Side question: a child thread under this one (#1101 category 20). */
export function useForkThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.fork.mutationOptions(),
		onSettled: () => refreshThreads(queryClient),
	});
}

/** Keep as thread: a side question becomes a listed fork. */
export function useKeepAside() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.keep.mutationOptions(),
		onSettled: () => refreshThreads(queryClient),
	});
}

/** A thread's row from any loaded feed page: its pin, archive and settle state for the header menu. */
export function useFeedRow(id: string): ThreadRow | undefined {
	const queryClient = useQueryClient();
	// Re-read when a feed page changes, so a settle or a pin shows in the header too.
	const [, bump] = useReducer((n: number) => n + 1, 0);
	useEffect(
		() =>
			queryClient.getQueryCache().subscribe((e) => {
				if (
					e.type === "updated" &&
					partialMatchKey(e.query.queryKey, orpc.threads.feed.key())
				)
					bump();
			}),
		[queryClient],
	);
	const pages = queryClient.getQueriesData<{ pages: ThreadFeed[] }>({
		queryKey: orpc.threads.feed.key(),
	});
	for (const [, data] of pages)
		for (const page of data?.pages ?? [])
			for (const u of page.units)
				for (const t of u.threads) if (t.id === id) return t;
	return undefined;
}

/** The closed-set status of each named thread (#1101 category 2), refetched while anything is live. */
export function useThreadStatuses(ids: readonly string[]) {
	const sorted = Array.from(new Set(ids)).sort();
	return useQuery({
		...orpc.threads.statuses.queryOptions({ input: { ids: sorted } }),
		enabled: sorted.length > 0,
		refetchInterval: useLiveRefreshInterval(),
		placeholderData: (prev) => prev,
	});
}
