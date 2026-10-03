// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveTopic } from "@prismalens/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { client, orpc } from "./orpc-client";

/** Lists re-read on this interval only while the change stream is down (walk f27). */
export const LIVE_REFRESH_MS = 10_000;
const RETRY_MS = 3_000;

/** The reconnect line shows once the stream has been down this long (study-v2 §6). */
export const RECONNECT_LINE_AFTER_MS = 10_000;

interface StreamStatus {
	connected: boolean;
	/** When the stream last went down, or when this page started waiting for it. */
	lostAt: number;
}

let status: StreamStatus = { connected: false, lostAt: Date.now() };
const listeners = new Set<() => void>();
function setConnected(next: boolean) {
	if (status.connected === next) return;
	status = { connected: next, lostAt: next ? status.lostAt : Date.now() };
	listeners.forEach((l) => {
		l();
	});
}
function subscribeConnected(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
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

/** Whether the change stream is up, and since when it is not. */
export function useStreamStatus(): StreamStatus {
	return useSyncExternalStore(
		subscribeConnected,
		() => status,
		() => SERVER_STATUS,
	);
}

/** The time the screen is "as of" when the line should show, else null. */
export function reconnectAsOf(s: StreamStatus, now: number): number | null {
	if (s.connected || now - s.lostAt < RECONNECT_LINE_AFTER_MS) return null;
	return s.lostAt;
}

const KEYS_BY_TOPIC: Record<LiveTopic, () => unknown[][]> = {
	incidents: () => [orpc.incidents.key()],
	alerts: () => [orpc.alerts.key(), orpc.incidents.key()],
	investigations: () => [orpc.investigations.key(), orpc.incidents.key()],
};

export function invalidateTopics(
	queryClient: QueryClient,
	topics: readonly LiveTopic[],
): void {
	const seen = new Set<string>();
	for (const queryKey of topics.flatMap((t) => KEYS_BY_TOPIC[t]())) {
		const id = JSON.stringify(queryKey);
		if (seen.has(id)) continue;
		seen.add(id);
		void queryClient.invalidateQueries({ queryKey });
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
				try {
					const stream = await client.live.changes({}, { signal });
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
						invalidateTopics(queryClient, change.topics);
					}
				} catch {
					// Dropped or refused: poll until the next attempt connects.
				}
				setConnected(false);
				if (signal.aborted) break;
				await new Promise((r) => setTimeout(r, RETRY_MS));
				first = false;
			}
		})();
		return () => controller.abort();
	}, [queryClient]);
}
