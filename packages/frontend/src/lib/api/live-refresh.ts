// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveTopic } from "@prismalens/contracts";
import {
	matchQuery,
	partialMatchKey,
	type Query,
	type QueryClient,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { orpc } from "./orpc-client";

/** Lists re-read on this interval only while the change stream is down (walk f27). */
export const LIVE_REFRESH_MS = 10_000;

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
export function setConnected(next: boolean) {
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

/** Cuts the stream's wait before its next attempt short, in whichever tab holds the stream. */
let retrySoon: (() => void) | null = null;

/** live-stream.ts sets it: the stream's own retry, or the leader's over the channel. */
export function setRetry(fn: (() => void) | null): void {
	retrySoon = fn;
}

/** The connection dock's Retry now (#1101): the next attempt starts at once, in whichever tab holds the stream. */
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

/** The change stream is up now: the server's hints re-read what changed. */
export const streamUp = (): boolean => status.connected;

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
		orpc.threadTree.key(),
	],
	// A run a schedule started moves its row and its history (#979).
	schedules: () => [orpc.schedules.key()],
	threads: () => [orpc.threads.key(), orpc.threadTree.key()],
	attention: () => [orpc.attention.key(), orpc.threads.key()],
	visits: () => [orpc.threads.feed.key()],
};

export const ALL_TOPICS = Object.keys(KEYS_BY_TOPIC) as LiveTopic[];

/** A run's event record and its files at a commit never change; the stream and catch-up extend the record (#874). */
const IMMUTABLE: readonly unknown[][] = [
	orpc.investigations.getEvents.key(),
	orpc.investigations.getBlob.key(),
];

/** Read only their own thread's row, so a hint scoped to other threads skips them (#1181). */
const PER_THREAD: readonly unknown[][] = [
	orpc.investigations.get.key(),
	orpc.investigations.getStatus.key(),
];

function mutable(query: Query): boolean {
	return !IMMUTABLE.some((key) => partialMatchKey(query.queryKey, key));
}

const inputId = (q: Query): unknown =>
	(q.queryKey[1] as { input?: { id?: unknown } } | undefined)?.input?.id;

/** live-stream.ts re-applies heard activity over any read that lands older. */
let afterRead: ((qc: QueryClient, q: Query) => void) | null = null;
export function onRead(fn: (qc: QueryClient, q: Query) => void): void {
	afterRead = fn;
}

/** Queries a hint reached mid-fetch, by client: each re-reads once when that fetch ends. */
const trailing = new WeakMap<QueryClient, Set<string>>();

export function trailingFor(queryClient: QueryClient): Set<string> {
	let set = trailing.get(queryClient);
	if (set) return set;
	const pending = new Set<string>();
	set = pending;
	trailing.set(queryClient, pending);
	queryClient.getQueryCache().subscribe((event) => {
		const q = event.query;
		if (
			event.type === "updated" &&
			event.action.type === "success" &&
			!event.action.manual
		)
			afterRead?.(queryClient, q);
		if (q.state.fetchStatus !== "idle" || !pending.delete(q.queryHash)) return;
		void queryClient.invalidateQueries(
			{ queryKey: q.queryKey, exact: true },
			{ cancelRefetch: false },
		);
	});
	return pending;
}

/**
 * Marks matching queries stale and re-reads the shown ones, never cancelling a fetch in
 * flight: on a slow link a hint each second would cancel every read (#1181). A success
 * clears `isInvalidated`, so a hint that lands mid-fetch queues one trailing read instead.
 */
export function refresh(
	queryClient: QueryClient,
	filters: readonly {
		queryKey: unknown[];
		predicate?: (q: Query) => boolean;
	}[],
): void {
	const pending = trailingFor(queryClient);
	// One pass over the cache: one invalidate per query scans it again, which a busy page pays per hint.
	const stale = new Set<string>();
	for (const q of queryClient.getQueryCache().getAll()) {
		if (!filters.some((f) => matchQuery(f, q))) continue;
		if (q.state.fetchStatus === "fetching") pending.add(q.queryHash);
		else stale.add(q.queryHash);
	}
	if (stale.size)
		void queryClient.invalidateQueries(
			{ predicate: (q) => stale.has(q.queryHash) },
			{ cancelRefetch: false },
		);
}

export function invalidateTopics(
	queryClient: QueryClient,
	topics: readonly LiveTopic[],
	scope?: readonly string[],
): void {
	const elsewhere = (q: Query) =>
		!!scope &&
		PER_THREAD.some((key) => partialMatchKey(q.queryKey, key)) &&
		!scope.includes(inputId(q) as string);
	refresh(
		queryClient,
		topics
			.flatMap((t) => KEYS_BY_TOPIC[t]())
			.map((queryKey) => ({
				queryKey,
				predicate: (q: Query) => mutable(q) && !elsewhere(q),
			})),
	);
}

/**
 * Joins the browser's one change stream while signed in. Its code loads after first paint:
 * the stream starts once tabs have elected who holds it (#1181).
 */
export function useLiveChanges(): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		let stop: (() => void) | undefined;
		let gone = false;
		void import("./live-stream").then((m) => {
			if (!gone) stop = m.startLiveStream(queryClient);
		});
		return () => {
			gone = true;
			stop?.();
		};
	}, [queryClient]);
}
