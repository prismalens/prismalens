// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The app's attention loop (#1101 categories 3 and 4), mounted once while signed in:
 * holds this device's foreground lease, keeps the needs-you count for the tab title
 * and the badge, and turns each new event into a toast, a notification or a sound.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { client, orpc } from "@/lib/api/orpc-client";
import { setNeedsCount, useNeedsCount } from "@/lib/attention/needs-count";
import { decide, notificationText } from "@/lib/attention/notify-rules";
import { playNeedsYou } from "@/lib/attention/sound";
import {
	useAttentionEvents,
	useNotifyPrefs,
	useTabFocused,
	useTabVisible,
} from "@/lib/attention/use-attention";

/** Renewed well inside the server's 60 s lease. */
const RENEW_MS = 25_000;
const TOASTS_MAX = 2;
const THREAD_PATH = /^\/threads\/([0-9a-f-]{36})(?:\/|$)/i;

export function threadOnScreen(pathname: string): string | null {
	return THREAD_PATH.exec(pathname)?.[1] ?? null;
}

function permission(): NotificationPermission | "unsupported" {
	return typeof Notification === "undefined"
		? "unsupported"
		: Notification.permission;
}

function usePresence(threadId: string | null) {
	const visible = useTabVisible();
	useEffect(() => {
		if (!visible) {
			void client.attention
				.presence({ threadId: null, visible: false })
				.catch(() => {});
			return;
		}
		const hold = () =>
			void client.attention
				.presence({ threadId, visible: true })
				.catch(() => {});
		hold();
		const t = setInterval(hold, RENEW_MS);
		return () => clearInterval(t);
	}, [visible, threadId]);
	useEffect(() => {
		const drop = () =>
			void client.attention
				.presence({ threadId: null, visible: false })
				.catch(() => {});
		window.addEventListener("pagehide", drop);
		return () => window.removeEventListener("pagehide", drop);
	}, []);
}

function useNeedsYouCount() {
	const feed = useQuery({
		...orpc.threads.feed.queryOptions({ input: { limit: 1, cursor: 0 } }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const n = feed.data?.counts.needsThreads ?? 0;
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

interface ShownToast {
	id: string;
	title: string;
	body: string;
	threadId: string;
	tone: "default" | "neutral" | "destructive";
}

export function AttentionRuntime() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const viewing = threadOnScreen(pathname);
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
	const events = useAttentionEvents("all", 20);
	const navigate = useNavigate();
	const seen = useRef<Set<string> | null>(null);
	const [toasts, setToasts] = useState<ShownToast[]>([]);

	const open = useCallback(
		(threadId: string, eventId: string) => {
			void client.attention.markRead({ ids: [eventId] }).catch(() => {});
			void navigate({ to: "/threads/$id", params: { id: threadId } });
		},
		[navigate],
	);

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
		for (const e of fresh) {
			if (e.readAt) continue;
			const d = decide(e, prefs, {
				focused,
				viewing,
				permission: permission(),
			});
			const text = notificationText(e);
			if (d.toast)
				setToasts((t) =>
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
						},
						...t,
					].slice(0, TOASTS_MAX),
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
			if (d.sound) playNeedsYou();
		}
	}, [events.data, prefs, focused, viewing, open]);

	return (
		<ToastProvider swipeDirection="right">
			{toasts.map((t) => (
				<Toast
					key={t.id}
					variant={t.tone}
					duration={8000}
					onOpenChange={(o) => {
						if (!o) setToasts((all) => all.filter((x) => x.id !== t.id));
					}}
					data-testid="attention-toast"
				>
					<button
						type="button"
						className="flex min-w-0 flex-col items-start text-left focus-visible:outline-none"
						onClick={() => {
							setToasts((all) => all.filter((x) => x.id !== t.id));
							open(t.threadId, t.id);
						}}
					>
						<ToastTitle>{t.title}</ToastTitle>
						{t.body && <ToastDescription>{t.body}</ToastDescription>}
					</button>
					<ToastClose />
				</Toast>
			))}
			<ToastViewport className="top-12 bottom-auto" />
		</ToastProvider>
	);
}
