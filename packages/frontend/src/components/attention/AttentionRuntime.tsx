// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The app's attention loop (#1101 categories 3 and 4), mounted once while signed in:
 * holds this device's foreground lease, keeps the needs-you count for the tab title
 * and the badge, and turns each new event into a toast, a notification or a sound.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { kindStatus } from "@/components/home/AwayView";
import { statusUrgency } from "@/components/kit/Status";
import { useThreadListModel } from "@/components/shell/ThreadList";
import { client, orpc } from "@/lib/api/orpc-client";
import {
	setAttentionOpener,
	setAttentionToasts,
} from "@/lib/attention/attention-toasts";
import { setNeedsCount, useNeedsCount } from "@/lib/attention/needs-count";
import { decide, notificationText } from "@/lib/attention/notify-rules";
import { playNeedsYou } from "@/lib/attention/sound";
import {
	useNotifyPrefs,
	useTabFocused,
	useTabVisible,
	useUnreadAttention,
} from "@/lib/attention/use-attention";

/** Renewed well inside the server's 60 s lease. */
const RENEW_MS = 25_000;
const TOASTS_MAX = 2;
const THREAD_PATH = /^\/threads\/([0-9a-f-]{36})(?:\/|$)/i;

const ID = /^[0-9a-f-]{36}$/i;

/** The thread open on screen: its own page, or an incident's conversation with it (#1101 cat 4). */
export function threadOnScreen(
	pathname: string,
	search?: { investigation?: unknown },
): string | null {
	const own = THREAD_PATH.exec(pathname)?.[1];
	if (own) return own;
	const inv = search?.investigation;
	return /^\/incidents\/[^/]+\/conversation\/?$/.test(pathname) &&
		typeof inv === "string" &&
		ID.test(inv)
		? inv
		: null;
}

function permission(): NotificationPermission | "unsupported" {
	return typeof Notification === "undefined"
		? "unsupported"
		: Notification.permission;
}

function usePresence(threadId: string | null) {
	const visible = useTabVisible();
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!visible) {
			void client.attention
				.presence({ threadId: null, visible: false })
				.catch(() => {});
			return;
		}
		const hold = () =>
			client.attention.presence({ threadId, visible: true }).catch(() => {});
		// The first lease is what starts a new away; Home's baseline is read again after it,
		// so every device shows the same "Since" (#1101 cat 3 item 1).
		void hold().then(() =>
			queryClient.invalidateQueries({ queryKey: orpc.attention.away.key() }),
		);
		const t = setInterval(() => void hold(), RENEW_MS);
		return () => clearInterval(t);
	}, [visible, threadId, queryClient]);
	useEffect(() => {
		const drop = () =>
			void client.attention
				.presence({ threadId: null, visible: false })
				.catch(() => {});
		window.addEventListener("pagehide", drop);
		return () => window.removeEventListener("pagehide", drop);
	}, []);
}

/** The list's own Needs-you count, so the tab title, the badge and the list agree (#1101 cat 1). */
function useNeedsYouCount() {
	const n = useThreadListModel().model.needsCount;
	useEffect(() => setNeedsCount(n), [n]);
	return n;
}

/** The app badge where the browser has one (installed apps, some desktops). */
function useBadge(n: number) {
	useEffect(() => {
		const nav = navigator as Navigator & {
			setAppBadge?: (n?: number) => Promise<void>;
			clearAppBadge?: () => Promise<void>;
		};
		if (!nav.setAppBadge) return;
		void (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.())?.catch(() => {});
	}, [n]);
}

export function AttentionRuntime() {
	const viewing = useRouterState({
		select: (s) =>
			threadOnScreen(
				s.location.pathname,
				s.location.search as { investigation?: unknown },
			),
	});
	usePresence(viewing);
	const needs = useNeedsYouCount();
	useBadge(needs);
	const titled = useNeedsCount();
	// A page that sets no title still carries the count.
	useEffect(() => {
		if (!/^\(\d+\) /.test(document.title) && titled > 0)
			document.title = `(${titled}) ${document.title}`;
	}, [titled]);

	const prefs = useNotifyPrefs();
	const focused = useTabFocused();
	// Only unread events notify, so the shell's shared unread query is the feed (#1130).
	const events = useUnreadAttention();
	const navigate = useNavigate();
	const seen = useRef<Set<string> | null>(null);

	const open = useCallback(
		(threadId: string, eventId: string) => {
			void client.attention.markRead({ ids: [eventId] }).catch(() => {});
			void navigate({ to: "/threads/$id", params: { id: threadId } });
		},
		[navigate],
	);
	useEffect(() => {
		setAttentionOpener(open);
		return () => setAttentionOpener(null);
	}, [open]);

	useEffect(() => {
		const list = events.data?.events;
		if (!list) return;
		// What was there when the app opened is history, not news.
		if (!seen.current) {
			seen.current = new Set(list.map((e) => e.id));
			return;
		}
		const fresh = list.filter((e) => !seen.current?.has(e.id)).reverse();
		for (const e of fresh) seen.current.add(e.id);
		let ring = false;
		for (const e of fresh) {
			if (e.readAt) continue;
			const d = decide(e, prefs, {
				focused,
				viewing,
				permission: permission(),
			});
			const text = notificationText(e);
			if (d.toast)
				setAttentionToasts((t) =>
					[
						{
							id: e.id,
							title: text.title,
							body: text.body,
							threadId: e.threadId,
							tone:
								e.kind === "finished"
									? ("default" as const)
									: e.kind === "failed" || e.kind === "blocked"
										? ("destructive" as const)
										: ("neutral" as const),
							urgency: statusUrgency(
								kindStatus(e.kind, e.thread.status ?? null),
							),
						},
						// One toast per thread: its newer event replaces the older (#1101 cat 4).
						...t.filter((x) => x.threadId !== e.threadId),
					]
						.sort((a, b) => a.urgency - b.urgency)
						.slice(0, TOASTS_MAX),
				);
			if (d.os) {
				try {
					const n = new Notification(text.title, {
						body: text.body,
						// One per thread: a newer event replaces the thread's last one.
						tag: `thread-${e.threadId}`,
						icon: "/favicon.svg",
					});
					n.onclick = () => {
						window.focus();
						open(e.threadId, e.id);
						n.close();
					};
				} catch {
					// Some browsers refuse page notifications without a service worker.
				}
			}
			if (d.sound) ring = true;
		}
		// A burst of events rings once.
		if (ring) playNeedsYou();
	}, [events.data, prefs, focused, viewing, open]);

	// The toast layer draws them (AttentionToasts), so first paint ships no toast code.
	return null;
}
