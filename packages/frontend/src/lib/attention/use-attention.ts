// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The attention API's hooks (#1101 categories 3 and 4): the event list, Home's
 * away view, each thread's read position, and the notification choices.
 */
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { streamUp, useLiveRefreshInterval } from "@/lib/api/live-refresh";
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

/**
 * The unread events every shell part reads: the list's unread marks, the Events count and the
 * notifications share this one query, so a page load asks once (#1130).
 */
export const useUnreadAttention = (enabled = true) =>
	useAttentionEvents("unread", UNREAD_LIMIT, enabled);
/** The API's most; the server's count covers every unread event. */
const UNREAD_LIMIT = 200;

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
/** While new lines keep arriving, the read position moves at most this often (#1181). */
export const READ_EVERY_MS = 10_000;

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
	const sentAt = useRef(0);
	const latest = useRef(lastOnScreen);
	latest.current = lastOnScreen;
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			clearTimeout(timer.current);
			timer.current = undefined;
		},
		[id],
	);
	useEffect(() => {
		if (!ready || !visible || !lastOnScreen || sent.current === lastOnScreen)
			return;
		if (timer.current) return;
		const send = () => {
			timer.current = undefined;
			const key = latest.current;
			if (!key || sent.current === key || document.hidden) return;
			sent.current = key;
			sentAt.current = Date.now();
			void client.attention
				.markThreadRead({ id, key })
				.then((r) => {
					// While the change stream is up, the server's hint re-reads the list.
					if (r.advanced && !streamUp())
						void queryClient.invalidateQueries({
							queryKey: orpc.attention.events.key(),
						});
				})
				.catch(() => {
					sent.current = null;
				});
		};
		timer.current = setTimeout(
			send,
			Math.max(READ_DEBOUNCE_MS, sentAt.current + READ_EVERY_MS - Date.now()),
		);
	}, [id, lastOnScreen, ready, visible, queryClient]);
}
