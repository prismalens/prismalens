// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveTopic } from "@prismalens/contracts";
import {
	partialMatchKey,
	type Query,
	type QueryClient,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { client, orpc } from "./orpc-client";
import { onDeviceOffline, watchSilence } from "./stream-liveness";

/** Lists re-read on this interval only while the change stream is down (walk f27). */
export const LIVE_REFRESH_MS = 10_000;
const RETRY_MS = 3_000;

/** The reconnect line shows once the stream has been down this long (study-v2 §6). */
export const RECONNECT_LINE_AFTER_MS = 10_000;

interface StreamStatus {
	connected: boolean;
	/** When the stream last went down, or when this page started waiting for it. */
	lostAt: number;
	/** It was up once on this page: down now is a drop, not a page still loading. */
	ever?: boolean;
}

let status: StreamStatus = { connected: false, lostAt: Date.now() };
const listeners = new Set<() => void>();
function setConnected(next: boolean) {
	if (status.connected === next) return;
	status = {
		connected: next,
		lostAt: next ? status.lostAt : Date.now(),
		ever: status.ever || next,
	};
	listeners.forEach((l) => {
		l();
	});
}
function subscribeConnected(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** Cuts the stream's wait before its next attempt short; set while it waits. */
let retrySoon: (() => void) | null = null;

/** The connection dock's Retry now (#1101): the next attempt starts at once. */
export function reconnectNow(): void {
	retrySoon?.();
}

/** `refetchInterval` for a list: off while hints arrive, polling while they can't. */
export function useLiveRefreshInterval(): number | false {
	const up = useSyncExternalStore(
		subscribeConnected,
		() => status.connected,
		() => false,
	);
	return up ? false : LIVE_REFRESH_MS;
}

const SERVER_STATUS: StreamStatus = { connected: true, lostAt: 0 };

/** The change stream was up once on this page: the server was reached at least once. */
export const hasConnected = (): boolean => status.ever === true;

/** Whether the change stream is up, and since when it is not. */
export function useStreamStatus(): StreamStatus {
	return useSyncExternalStore(
		subscribeConnected,
		() => status,
		() => SERVER_STATUS,
	);
}

/** The time the screen is "as of" once the stream has been down `RECONNECT_LINE_AFTER_MS`, else null. */
export function reconnectAsOf(s: StreamStatus, now: number): number | null {
	if (s.connected || now - s.lostAt < RECONNECT_LINE_AFTER_MS) return null;
	return s.lostAt;
}

/** The reconnect line: at once after a drop, or after the wait while a page never connected. */
export function lineAsOf(s: StreamStatus, now: number): number | null {
	if (s.connected) return null;
	return s.ever ? s.lostAt : reconnectAsOf(s, now);
}

// An alert or incident moves the board's setup line and Alert sources' last delivery.
const KEYS_BY_TOPIC: Record<LiveTopic, () => unknown[][]> = {
	// A Do now tick and a Timeline entry are written under the incident's topic (live-changes.ts).
	incidents: () => [
		orpc.incidents.key(),
		orpc.setup.key(),
		orpc.recommendations.key(),
		orpc.timeline.key(),
		orpc.threads.key(),
	],
	alerts: () => [
		orpc.alerts.key(),
		orpc.incidents.key(),
		orpc.setup.key(),
		orpc.webhooks.lastDelivery.key(),
	],
	investigations: () => [
		orpc.investigations.key(),
		orpc.incidents.key(),
		orpc.schedules.key(),
		orpc.threads.key(),
	],
	// A run a schedule started moves its row and its history (#979).
	schedules: () => [orpc.schedules.key()],
	threads: () => [orpc.threads.key()],
	attention: () => [orpc.attention.key(), orpc.threads.key()],
};

/** A run's event record and its files at a commit never change; the stream and catch-up extend the record (#874). */
const IMMUTABLE: readonly unknown[][] = [
	orpc.investigations.getEvents.key(),
	orpc.investigations.getBlob.key(),
];

function mutable(query: Query): boolean {
	return !IMMUTABLE.some((key) => partialMatchKey(query.queryKey, key));
}

export function invalidateTopics(
	queryClient: QueryClient,
	topics: readonly LiveTopic[],
): void {
	const seen = new Set<string>();
	for (const queryKey of topics.flatMap((t) => KEYS_BY_TOPIC[t]())) {
		const id = JSON.stringify(queryKey);
		if (seen.has(id)) continue;
		seen.add(id);
		void queryClient.invalidateQueries({ queryKey, predicate: mutable });
	}
}

/** Holds the app's one change stream open while signed in; reconnects, refetching what it missed. */
export function useLiveChanges(): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		const controller = new AbortController();
		const { signal } = controller;
		void (async () => {
			let first = true;
			while (!signal.aborted) {
				// One attempt: a silent link, the device going offline or the page leaving ends it.
				const attempt = new AbortController();
				const end = () => attempt.abort();
				signal.addEventListener("abort", end, { once: true });
				const offOffline = onDeviceOffline(end);
				const watch = watchSilence(end);
				try {
					const stream = await client.live.changes(
						{},
						{ signal: attempt.signal },
					);
					watch.open();
					setConnected(true);
					if (!first) {
						invalidateTopics(queryClient, [
							"incidents",
							"alerts",
							"investigations",
						]);
					}
					first = false;
					for await (const change of stream) {
						watch.beat();
						if ("topics" in change)
							invalidateTopics(queryClient, change.topics);
					}
				} catch {
					// Dropped, silent or refused: poll until the next attempt connects.
				} finally {
					watch.stop();
					offOffline();
					signal.removeEventListener("abort", end);
				}
				setConnected(false);
				if (signal.aborted) break;
				await new Promise<void>((r) => {
					// Offline, the next try waits for the device to say it is back.
					const wait = navigator.onLine === false ? null : RETRY_MS;
					const t = wait === null ? undefined : setTimeout(done, wait);
					window.addEventListener("online", done);
					signal.addEventListener("abort", done);
					function done() {
						clearTimeout(t);
						window.removeEventListener("online", done);
						signal.removeEventListener("abort", done);
						retrySoon = null;
						r();
					}
					retrySoon = done;
				});
				first = false;
			}
		})();
		return () => controller.abort();
	}, [queryClient]);
}
