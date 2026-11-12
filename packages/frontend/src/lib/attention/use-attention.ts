// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The attention API's hooks (#1101 categories 3 and 4): the event list, Home's
 * away view, each thread's read position, and the notification choices.
 */
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { client, orpc } from "@/lib/api/orpc-client";

export function useAttentionEvents(
	filter: "unread" | "all",
	limit = 50,
	enabled = true,
) {
	return useQuery({
		...orpc.attention.events.queryOptions({ input: { filter, limit } }),
		enabled,
		refetchInterval: useLiveRefreshInterval(),
	});
}

export function useMarkEventsRead() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.attention.markRead.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orpc.attention.key() }),
	});
}

export function useAwayView() {
	return useQuery({
		...orpc.attention.away.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
}

export function useNotifyPrefs(): NotifyPrefs {
	const q = useQuery(orpc.attention.prefs.queryOptions({ input: {} }));
	return q.data ?? DEFAULT_NOTIFY_PREFS;
}

export function useSetNotifyPrefs() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.attention.setPrefs.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(
				orpc.attention.prefs.queryKey({ input: {} }),
				data,
			),
	});
}

export function useFollowThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.attention.follow.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orpc.attention.key() }),
	});
}

/**
 * Where the operator had read this thread to when the page opened. Read once and
 * held: the position advances while the page shows the thread, the divider stays.
 */
export function useOpeningRead(id: string) {
	return useQuery({
		...orpc.attention.threadRead.queryOptions({ input: { id } }),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchInterval: false,
	});
}

// ---- the tab is visible ----

function subscribeVisible(l: () => void) {
	document.addEventListener("visibilitychange", l);
	return () => document.removeEventListener("visibilitychange", l);
}

export function useTabVisible(): boolean {
	return useSyncExternalStore(
		subscribeVisible,
		() => document.visibilityState === "visible",
		() => false,
	);
}

function subscribeFocus(l: () => void) {
	window.addEventListener("focus", l);
	window.addEventListener("blur", l);
	document.addEventListener("visibilitychange", l);
	return () => {
		window.removeEventListener("focus", l);
		window.removeEventListener("blur", l);
		document.removeEventListener("visibilitychange", l);
	};
}

/** Visible and focused: the operator is looking at this tab. */
export function useTabFocused(): boolean {
	return useSyncExternalStore(
		subscribeFocus,
		() => document.visibilityState === "visible" && document.hasFocus(),
		() => false,
	);
}

const READ_DEBOUNCE_MS = 800;

/**
 * Advances the thread's read position to the last event on screen, only while the
 * tab is visible and only once the opening position is held.
 */
export function useReadAdvance(
	id: string,
	lastOnScreen: string | null,
	ready: boolean,
): void {
	const visible = useTabVisible();
	const queryClient = useQueryClient();
	const sent = useRef<string | null>(null);
	useEffect(() => {
		if (!ready || !visible || !lastOnScreen || sent.current === lastOnScreen)
			return;
		const t = setTimeout(() => {
			sent.current = lastOnScreen;
			void client.attention
				.markThreadRead({ id, key: lastOnScreen })
				.then((r) => {
					if (r.advanced)
						void queryClient.invalidateQueries({
							queryKey: orpc.attention.events.key(),
						});
				})
				.catch(() => {
					sent.current = null;
				});
		}, READ_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [id, lastOnScreen, ready, visible, queryClient]);
}
