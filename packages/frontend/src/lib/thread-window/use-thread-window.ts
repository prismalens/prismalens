// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * A long thread read in windows (#1101 cat 12): one round trip opens it at the tail,
 * a linked item or a named position; pages load before and after as the reader
 * scrolls; a jump loads the page around its target; the stream resumes from a
 * commit cursor and reconnects without a reload; a cached window renders first.
 */
import {
	type CanonicalEvent,
	CommitFrameSchema,
	DoneFrameSchema,
	LiveFrameSchema,
	ResetFrameSchema,
} from "@prismalens/contracts";
import { createStore, del, get, set } from "idb-keyval";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { client } from "@/lib/api/orpc-client";
import {
	onDeviceOffline,
	type SilenceWatch,
	watchSilence,
} from "@/lib/api/stream-liveness";
import { takeWindow } from "./prefetch";
import { ThreadWindowStore, type WindowSnapshot } from "./window-store";

/** Waits before each reconnect after a drop; the last repeats. */
export const RECONNECT_MS = [1_000, 2_000, 5_000, 15_000];
const SNAPSHOT_DEBOUNCE_MS = 1_500;
/** A page asked for as the network drops can hang; past this it fails into Retry. */
export const PAGE_TIMEOUT_MS = 20_000;
const timeout = () => ({ signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
const INDEX_REFRESH_MS = 5_000;

export type Connection = "idle" | "connecting" | "live" | "reconnecting";

let snapshots: ReturnType<typeof createStore> | null = null;
function snapshotStore() {
	if (typeof indexedDB === "undefined") return null;
	snapshots ??= createStore("prismalens-thread-window", "snapshots");
	return snapshots;
}

async function readSnapshot(id: string): Promise<WindowSnapshot | null> {
	try {
		const store = snapshotStore();
		return store ? ((await get<WindowSnapshot>(id, store)) ?? null) : null;
	} catch {
		return null;
	}
}

function writeSnapshot(id: string, s: WindowSnapshot | null): void {
	try {
		const store = snapshotStore();
		if (!store) return;
		void (s ? set(id, s, store) : del(id, store)).catch(() => {});
	} catch {
		// Private mode or blocked storage: the window simply opens from the server.
	}
}

export interface ThreadWindowOptions {
	enabled: boolean;
	/** The run is live: hold the stream open. */
	live: boolean;
	/** Open at this item (`#item-…`) instead of the tail. */
	at?: string;
	/** A named position a server resolver answers, e.g. `unread`. */
	position?: string;
	/** The stream ended cleanly: the caller refreshes the row. */
	onDone?: () => void;
}

export function useThreadWindow(id: string, opts: ThreadWindowOptions) {
	const store = useMemo(() => new ThreadWindowStore(), [id]);
	const version = useSyncExternalStore(
		store.subscribe,
		store.getVersion,
		store.getVersion,
	);
	const [openError, setOpenError] = useState<unknown>(null);
	const [opening, setOpening] = useState(false);
	/** Where the server opened the window, e.g. the first unseen event. */
	const [landing, setLanding] = useState<string | null>(null);
	const [connection, setConnection] = useState<Connection>("idle");
	const [catchUp, setCatchUp] = useState(0);
	const onDone = useRef(opts.onDone);
	onDone.current = opts.onDone;

	const open = useCallback(
		async (at?: string, position?: string) => {
			setOpening(true);
			setOpenError(null);
			try {
				const landing = {
					...(at ? { at } : {}),
					...(position ? { position } : {}),
				};
				// The route started this page while its code loaded; else ask now.
				const result = await (takeWindow(id, landing) ??
					client.investigations.openWindow({ id, fold: true, ...landing }));
				setLanding(result.landing);
				store.applyOpen(result);
				return result.landing;
			} catch (e) {
				setOpenError(e);
				return null;
			} finally {
				setOpening(false);
			}
		},
		[id, store],
	);

	// A cached window renders first, then the server's replaces it.
	const { enabled, at, position } = opts;
	useEffect(() => {
		if (!enabled || !id) return;
		let gone = false;
		void readSnapshot(id).then((s) => {
			if (!gone && s) store.hydrate(s);
		});
		void open(at, position);
		return () => {
			gone = true;
		};
	}, [enabled, id, at, position, open, store]);

	// The last-seen window, kept for the next visit (committed events only).
	useEffect(() => {
		if (store.source !== "server") return;
		const t = setTimeout(
			() => writeSnapshot(id, store.snapshot()),
			SNAPSHOT_DEBOUNCE_MS,
		);
		return () => clearTimeout(t);
	}, [version, id, store]);

	const loadBefore = useCallback(async () => {
		if (!store.hasBefore || !store.lo || store.edges.before === "loading")
			return;
		store.setEdge("before", "loading");
		try {
			const page = await client.investigations.windowPage(
				{
					id,
					gen: store.gen,
					before: store.lo,
					fold: true,
				},
				timeout(),
			);
			store.applyPage(page, "before");
		} catch (e) {
			if (isStale(e)) return void open();
			store.setEdge("before", "error");
		}
	}, [id, store, open]);

	const loadAfter = useCallback(async () => {
		if (!store.hasAfter || !store.hi || store.edges.after === "loading") return;
		store.setEdge("after", "loading");
		try {
			const page = await client.investigations.windowPage(
				{
					id,
					gen: store.gen,
					after: store.hi,
					fold: true,
				},
				timeout(),
			);
			store.applyPage(page, "after");
		} catch (e) {
			if (isStale(e)) return void open();
			store.setEdge("after", "error");
		}
	}, [id, store, open]);

	/** Load the page around an item when the window lacks it; resolves once it is in. */
	const jumpTo = useCallback(
		async (key: string): Promise<boolean> => {
			if (store.items.has(key)) return true;
			try {
				const page = await client.investigations.windowPage(
					{
						id,
						gen: store.gen,
						around: key,
						fold: true,
					},
					timeout(),
				);
				store.applyPage(page, "replace");
				return store.items.has(key);
			} catch (e) {
				if (isStale(e)) await open(key);
				return store.items.has(key);
			}
		},
		[id, store, open],
	);

	/** Back to the record's end: the tail page, unless the window already holds it. */
	const toTail = useCallback(async () => {
		store.clearNew();
		if (!store.hasAfter) return;
		await open();
	}, [store, open]);

	const unfold = useCallback(
		async (turnKey: string) => {
			const page = await client.investigations.windowPage({
				id,
				gen: store.gen,
				turn: turnKey,
			});
			store.applyTurn(turnKey, page);
		},
		[id, store],
	);

	const full = useCallback(
		async (key: string) => {
			const r = await client.investigations.eventFull({
				id,
				gen: store.gen,
				key,
			});
			store.applyFull(key, r.event);
		},
		[id, store],
	);

	// The index's turn summaries lag a commit that started a turn; refetch them after a pause.
	useEffect(() => {
		if (!store.indexStale) return;
		const t = setTimeout(() => {
			client.investigations
				.windowIndex({ id })
				.then((index) => store.applyIndex(index))
				.catch(() => {});
		}, INDEX_REFRESH_MS);
		return () => clearTimeout(t);
	}, [version, id, store]);

	// The stream: held while live, once more when a run ends, and on `pull()`.
	const live = opts.live;
	const opened = store.gen >= 0 && store.source === "server";
	const gen = store.gen;
	const wasLive = useRef(live);
	useEffect(() => {
		if (wasLive.current && !live) setCatchUp((n) => n + 1);
		wasLive.current = live;
	}, [live]);
	useEffect(() => {
		if (!enabled || !opened || (!live && catchUp === 0)) return;
		let source: EventSource | null = null;
		let watch: SilenceWatch | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let attempt = 0;
		let stopped = false;
		const connect = () => {
			if (stopped) return;
			setConnection(attempt === 0 ? "connecting" : "reconnecting");
			const es = new EventSource(
				`/api/investigations/${id}/stream?v=2&after=${store.gen}.${store.through}`,
			);
			source = es;
			// A silent link never errors the source; its missing beats do (#1101 category 12).
			watch?.stop();
			const alive = watchSilence(() => es.onerror?.(new Event("error")));
			watch = alive;
			es.addEventListener("beat", () => alive.beat());
			const parse = <T>(
				schema: { safeParse(v: unknown): { success: boolean; data?: T } },
				raw: string,
			): T | null => {
				try {
					const r = schema.safeParse(JSON.parse(raw));
					return r.success ? (r.data as T) : null;
				} catch {
					return null;
				}
			};
			es.onopen = () => {
				alive.open();
				attempt = 0;
				setConnection("live");
			};
			es.addEventListener("live", (m) => {
				alive.beat();
				const f = parse(LiveFrameSchema, (m as MessageEvent).data);
				if (f) store.applyLive(f.gen, f.event as CanonicalEvent);
			});
			es.addEventListener("commit", (m) => {
				alive.beat();
				const f = parse(CommitFrameSchema, (m as MessageEvent).data);
				if (f) store.applyCommit(f);
			});
			es.addEventListener("done", (m) => {
				const f = parse(DoneFrameSchema, (m as MessageEvent).data);
				if (f) store.applyDone(f);
				alive.stop();
				es.close();
				stopped = true;
				setConnection("idle");
				onDone.current?.();
			});
			const reopen = () => {
				alive.stop();
				es.close();
				stopped = true;
				setConnection("idle");
				writeSnapshot(id, null);
				void open().then(() => setCatchUp((n) => n + 1));
			};
			es.addEventListener("reset", (m) => {
				if (parse(ResetFrameSchema, (m as MessageEvent).data)) reopen();
			});
			es.addEventListener("resync", reopen);
			es.onerror = () => {
				alive.stop();
				es.close();
				if (stopped || source !== es) return;
				setConnection("reconnecting");
				const wait =
					RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)] ?? 15_000;
				attempt++;
				timer = setTimeout(connect, wait);
			};
		};
		const online = () => {
			if (stopped || !source || source.readyState !== EventSource.CLOSED)
				return;
			clearTimeout(timer);
			connect();
		};
		window.addEventListener("online", online);
		// The device says it lost the network: the drop shows at once, not after the silence.
		const offOffline = onDeviceOffline(() => {
			if (source && source.readyState !== EventSource.CLOSED)
				source.onerror?.(new Event("error"));
		});
		connect();
		return () => {
			stopped = true;
			clearTimeout(timer);
			watch?.stop();
			offOffline();
			window.removeEventListener("online", online);
			source?.close();
			setConnection("idle");
		};
	}, [enabled, opened, live, catchUp, gen, id, store, open]);

	/** Read what was committed since the cursor, once: a follow-up that ended before it streamed. */
	const pull = useCallback(() => setCatchUp((n) => n + 1), []);

	const items = useMemo(() => store.sorted(), [version, store]);
	return {
		store,
		version,
		items,
		events: useMemo(() => items.map((i) => i.event), [items]),
		index: store.index,
		state: store.state,
		delta: store.delta,
		context: store.context,
		folded: store.folded,
		hasBefore: store.hasBefore,
		hasAfter: store.hasAfter,
		edges: store.edges,
		change: store.change,
		newCount: store.newCount,
		unsaved: store.unsaved,
		lost: store.lost,
		source: store.source,
		landing,
		loading: opening && store.source === "none",
		openError,
		connection,
		reopen: open,
		loadBefore,
		loadAfter,
		jumpTo,
		toTail,
		unfold,
		full,
		pull,
		clearNew: () => store.clearNew(),
	};
}

export type ThreadWindow = ReturnType<typeof useThreadWindow>;

function isStale(e: unknown): boolean {
	const m = (e as { message?: unknown })?.message;
	return typeof m === "string" && m.startsWith("STALE_GENERATION");
}
