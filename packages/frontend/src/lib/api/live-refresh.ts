// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	InvestigationWithRelations,
	LiveBeat,
	LiveChange,
	LiveReset,
	LiveTopic,
	ThreadActivity,
	ThreadFeed,
} from "@prismalens/contracts";
import {
	type InfiniteData,
	partialMatchKey,
	type Query,
	type QueryClient,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { joinLiveChannel, type LiveChannel, type Relay } from "./live-channel";
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
/** Asks whichever tab holds the stream: this one, or the leader over the channel. */
let followerRetry: (() => void) | null = null;

/** The connection dock's Retry now (#1101): the next attempt starts at once, in whichever tab holds the stream. */
export function reconnectNow(): void {
	if (followerRetry) followerRetry();
	else retrySoon?.();
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

const ALL_TOPICS = Object.keys(KEYS_BY_TOPIC) as LiveTopic[];

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

/** Queries a hint reached mid-fetch, by client: each re-reads once when that fetch ends. */
const trailing = new WeakMap<QueryClient, Set<string>>();

function trailingFor(queryClient: QueryClient): Set<string> {
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
			patch(queryClient, q);
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
	const cache = queryClient.getQueryCache();
	const queries = new Map(
		filters.flatMap((f) => cache.findAll(f)).map((q) => [q.queryHash, q]),
	);
	for (const q of Array.from(queries.values())) {
		if (q.state.fetchStatus === "fetching") pending.add(q.queryHash);
		else
			void queryClient.invalidateQueries(
				{ queryKey: q.queryKey, exact: true },
				{ cancelRefetch: false },
			);
	}
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

const ACTIVITY_KEEP_MS = 60_000;
type Heard = ThreadActivity & { heard: number };
/** The newest activity heard per thread, re-applied over any read that lands older. */
const activityMaps = new WeakMap<QueryClient, Map<string, Heard>>();
function activityOf(qc: QueryClient): Map<string, Heard> {
	let m = activityMaps.get(qc);
	if (!m) {
		m = new Map();
		activityMaps.set(qc, m);
	}
	return m;
}

const newer = (a: string, b: string | null | undefined) =>
	!b || Date.parse(a) > Date.parse(b);

function patchFeed(feed: ThreadFeed, map: Map<string, Heard>): ThreadFeed {
	let changed = false;
	const units = feed.units.map((u) => {
		let hit = false;
		const threads = u.threads.map((t) => {
			const a = map.get(t.id);
			if (!a || !newer(a.at, t.lastActivityAt)) return t;
			hit = true;
			return {
				...t,
				lastActivityAt: a.at,
				...(a.text ? { latestText: a.text } : {}),
			};
		});
		if (!hit) return u;
		changed = true;
		return { ...u, threads };
	});
	return changed ? { ...feed, units } : feed;
}

/** Writes heard activity into one feed or thread query: newer only, never reordered, never fetched. */
function patch(qc: QueryClient, q: Query): void {
	const map = activityMaps.get(qc);
	if (!map?.size || q.state.isInvalidated || q.state.data === undefined) return;
	let next: unknown = q.state.data;
	if (partialMatchKey(q.queryKey, orpc.threads.feed.key())) {
		const data = q.state.data as InfiniteData<ThreadFeed>;
		const pages = data.pages.map((p) => patchFeed(p, map));
		if (pages.some((p, i) => p !== data.pages[i])) next = { ...data, pages };
	} else if (partialMatchKey(q.queryKey, orpc.investigations.get.key())) {
		const inv = q.state.data as InvestigationWithRelations;
		const a = map.get(inv.id);
		if (a && inv.session && newer(a.at, inv.session.lastActivityAt))
			next = { ...inv, session: { ...inv.session, lastActivityAt: a.at } };
	}
	// Keeps the read's own time, so a patch never makes stale data look fresh (#1181).
	if (next !== q.state.data)
		qc.setQueryData(q.queryKey, next, { updatedAt: q.state.dataUpdatedAt });
}

/** Patches an agent's activity into the lists and its page in place. */
export function applyActivity(
	qc: QueryClient,
	activity: readonly ThreadActivity[],
): void {
	trailingFor(qc);
	const map = activityOf(qc);
	const now = Date.now();
	for (const [id, a] of Array.from(map))
		if (now - a.heard > ACTIVITY_KEEP_MS) map.delete(id);
	for (const a of activity) {
		const was = map.get(a.id);
		if (was && !newer(a.at, was.at)) continue;
		map.set(a.id, { ...a, text: a.text ?? was?.text, heard: now });
	}
	for (const q of qc.getQueryCache().findAll({
		predicate: (q) =>
			partialMatchKey(q.queryKey, orpc.threads.feed.key()) ||
			partialMatchKey(q.queryKey, orpc.investigations.get.key()),
	}))
		patch(qc, q);
}

/** This page's place in the change stream: what a reconnect sends back as `after`. */
let lastCursor: string | undefined;
const parseCursor = (c: string) => {
	const [epoch, seq] = c.split(".");
	return { epoch, seq: Number(seq) };
};

/** Applies one message of the change stream, heard directly or relayed by the tab holding it. */
export function applyChange(
	qc: QueryClient,
	m: LiveChange | LiveReset | LiveBeat,
): void {
	if ("beat" in m) {
		lastCursor ??= m.cursor;
		return;
	}
	if ("reset" in m) {
		lastCursor = m.cursor;
		performance.mark("pl:live-reset");
		invalidateTopics(qc, ALL_TOPICS);
		return;
	}
	if (lastCursor) {
		const was = parseCursor(lastCursor);
		const now = parseCursor(m.cursor);
		if (was.epoch === now.epoch && now.seq <= was.seq) return;
	}
	lastCursor = m.cursor;
	if (m.topics.length) invalidateTopics(qc, m.topics, m.scope);
	if (m.detail?.length)
		refresh(qc, [
			...m.detail.map((id) => ({
				queryKey: orpc.investigations.get.key({ input: { id } }),
			})),
			{ queryKey: orpc.investigations.list.key() },
		]);
	if (m.activity?.length) applyActivity(qc, m.activity);
}

const relayOf = (m: LiveChange | LiveReset | LiveBeat): Relay =>
	"beat" in m
		? { kind: "beat", cursor: m.cursor }
		: "reset" in m
			? { kind: "reset", change: m }
			: { kind: "frame", change: m };

/** Holds the change stream open while `signal` lives, reconnecting from its cursor. */
async function holdStream(
	qc: QueryClient,
	signal: AbortSignal,
	relay: (m: Relay) => void,
): Promise<void> {
	while (!signal.aborted) {
		// One attempt: a silent link, the device going offline or the page leaving ends it.
		const attempt = new AbortController();
		const end = () => attempt.abort();
		signal.addEventListener("abort", end, { once: true });
		const offOffline = onDeviceOffline(end);
		const watch = watchSilence(end);
		try {
			const stream = await client.live.changes(
				{ after: lastCursor },
				{ signal: attempt.signal },
			);
			watch.open();
			setConnected(true);
			relay({ kind: "status", connected: true });
			for await (const m of stream) {
				watch.beat();
				applyChange(qc, m);
				relay(relayOf(m));
			}
		} catch {
			// Dropped, silent or refused: poll until the next attempt connects.
		} finally {
			watch.stop();
			offOffline();
			signal.removeEventListener("abort", end);
		}
		if (signal.aborted) break;
		setConnected(false);
		relay({ kind: "status", connected: false });
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
	}
}

/** Joins the browser's one change stream while signed in: this tab holds it, or hears it relayed. */
export function useLiveChanges(): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		let channel: LiveChannel | undefined;
		channel = joinLiveChannel({
			lead: (signal) =>
				void holdStream(queryClient, signal, (m) => channel?.relay(m)),
			follow: (m) => {
				if (m.kind === "status") return setConnected(m.connected);
				applyChange(
					queryClient,
					m.kind === "beat" ? { beat: true, cursor: m.cursor } : m.change,
				);
			},
			retry: () => retrySoon?.(),
			connected: () => status.connected,
			setConnected,
			cursor: () => lastCursor,
		});
		followerRetry = () => channel?.retry();
		return () => {
			followerRetry = null;
			channel?.stop();
		};
	}, [queryClient]);
}
