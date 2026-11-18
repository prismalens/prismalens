// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	InvestigationWithRelations,
	LiveBeat,
	LiveChange,
	LiveReset,
	ThreadActivity,
	ThreadFeed,
} from "@prismalens/contracts";
import {
	type InfiniteData,
	partialMatchKey,
	type Query,
	type QueryClient,
} from "@tanstack/react-query";
import { joinLiveChannel, type LiveChannel, type Relay } from "./live-channel";
import {
	ALL_TOPICS,
	invalidateTopics,
	onRead,
	refresh,
	setConnected,
	setRetry,
	streamUp,
	trailingFor,
} from "./live-refresh";
import { client, orpc } from "./orpc-client";
import { onDeviceOffline, watchSilence } from "./stream-liveness";

const RETRY_MS = 3_000;
/** Cuts this tab's wait before its next attempt short; set while it waits. */
let ownRetry: (() => void) | null = null;

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

/** Built once: an oRPC key goes through its proxy on every call. */
let keys: { feed: unknown[]; get: unknown[] } | null = null;
const patchKeys = () =>
	(keys ??= {
		feed: orpc.threads.feed.key(),
		get: orpc.investigations.get.key(),
	});

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
	const k = patchKeys();
	if (partialMatchKey(q.queryKey, k.feed)) {
		const data = q.state.data as InfiniteData<ThreadFeed>;
		const pages = data.pages.map((p) => patchFeed(p, map));
		if (pages.some((p, i) => p !== data.pages[i])) next = { ...data, pages };
	} else if (partialMatchKey(q.queryKey, k.get)) {
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
	const k = patchKeys();
	for (const q of qc.getQueryCache().findAll({
		predicate: (q) =>
			partialMatchKey(q.queryKey, k.feed) || partialMatchKey(q.queryKey, k.get),
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
				ownRetry = null;
				r();
			}
			ownRetry = done;
		});
	}
}

/** Joins the browser's one change stream: this tab holds it, or hears it relayed. Returns the leave. */
export function startLiveStream(queryClient: QueryClient): () => void {
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
		retry: () => ownRetry?.(),
		connected: streamUp,
		setConnected,
		cursor: () => lastCursor,
	});
	setRetry(() => channel?.retry());
	return () => {
		setRetry(null);
		channel?.stop();
	};
}

onRead(patch);
