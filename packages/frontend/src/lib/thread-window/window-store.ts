// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The part of a long thread's record this page holds (#1101 categories 12-14): a
 * contiguous display range of pages, the whole-thread index the rail draws, the
 * thread-wide state, and the stream cursor. Plain TypeScript so it is tested
 * without React; `useThreadWindow` drives it.
 */
import {
	anchorIdsOf,
	anchorRefOf,
	type CanonicalEvent,
	type CommitFrame,
	type CutField,
	compareKeys,
	type DoneFrame,
	eventKey,
	type FoldedTurn,
	type IndexEntry,
	indexEntryOf,
	type OpenThread,
	type PageContext,
	type ThreadIndex,
	type ThreadPage,
	type ThreadState,
	turnAuthorOf,
} from "@prismalens/contracts";

export interface WindowItem {
	key: string;
	/** Commit position; null while the event is only provisional (sent live, not yet stored). */
	ordinal: number | null;
	event: CanonicalEvent;
	cut?: CutField[];
}

export type EdgeState = "idle" | "loading" | "error";
export type WindowChange = "replace" | "prepend" | "append" | "update";

export interface WindowSnapshot {
	v: 1;
	gen: number;
	through: number;
	index: ThreadIndex;
	items: WindowItem[];
	lo: string | null;
	hi: string | null;
	hasBefore: boolean;
	hasAfter: boolean;
	context: PageContext;
	folded: FoldedTurn[];
	state: ThreadState;
}

/** Events past the window's start the snapshot keeps: enough to read on, small enough for IndexedDB. */
export const SNAPSHOT_ITEMS = 300;
/** Events received after open, kept so thread-wide state can be overlaid. */
const DELTA_MAX = 2_000;

const NO_CONTEXT: PageContext = {
	stepsBefore: 0,
	endsBefore: 0,
	operatorsBefore: 0,
	agentBefore: false,
};

export class ThreadWindowStore {
	gen = -1;
	/** The resume cursor's ordinal: every committed event up to it has reached this page. */
	through = 0;
	lost = 0;
	index: ThreadIndex | null = null;
	items = new Map<string, WindowItem>();
	lo: string | null = null;
	hi: string | null = null;
	hasBefore = false;
	hasAfter = false;
	context: PageContext = NO_CONTEXT;
	folded = new Map<string, FoldedTurn>();
	state: ThreadState | null = null;
	delta: CanonicalEvent[] = [];
	source: "none" | "cached" | "server" = "none";
	edges: { before: EdgeState; after: EdgeState } = {
		before: "idle",
		after: "idle",
	};
	/** Messages that arrived past the window or below the reader. */
	newCount = 0;
	/** Live events the run sent that the record never stored, counted at `done`. */
	unsaved = 0;
	change: WindowChange = "replace";
	/** Bumped on every change; React reads it through useSyncExternalStore. */
	version = 0;
	/** Set when an index refetch is owed: a commit started a turn. */
	indexStale = false;

	private openers = new Map<string, string>();
	private listeners = new Set<() => void>();

	subscribe = (fn: () => void): (() => void) => {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	};

	getVersion = (): number => this.version;

	private emit(change: WindowChange): void {
		this.change = change;
		this.version++;
		for (const fn of Array.from(this.listeners)) fn();
	}

	/** Display-ordered events of the window. */
	sorted(): WindowItem[] {
		return Array.from(this.items.values()).sort((a, b) =>
			compareKeys(a.key, b.key),
		);
	}

	private remember(item: WindowItem): void {
		this.items.set(item.key, item);
		for (const a of anchorIdsOf(item.event))
			this.openers.set(`${a.kind}#${a.id}`, item.key);
	}

	private clearWindow(): void {
		this.items = new Map();
		this.openers = new Map();
		this.folded = new Map();
	}

	private takePage(
		page: ThreadPage,
		mode: "replace" | "before" | "after",
	): void {
		if (page.gen !== this.gen && this.gen !== -1 && mode !== "replace") return;
		if (mode === "replace") {
			this.clearWindow();
			this.lo = page.lo;
			this.hi = page.hi;
			this.hasBefore = page.hasBefore;
			this.hasAfter = page.hasAfter;
			this.context = page.context;
		} else if (mode === "before") {
			if (page.lo) this.lo = page.lo;
			this.hasBefore = page.hasBefore;
			this.context = page.context;
		} else {
			if (page.hi) this.hi = page.hi;
			this.hasAfter = page.hasAfter;
		}
		for (const it of page.items)
			if (!this.items.has(it.key) || this.items.get(it.key)?.ordinal === null)
				this.remember({
					key: it.key,
					ordinal: it.ordinal,
					event: it.event,
					...(it.cut ? { cut: it.cut } : {}),
				});
		for (const f of page.folded) this.folded.set(f.turnKey, f);
	}

	/** The first answer: index, a page at a position, thread-wide state and the cursor. */
	applyOpen(open: OpenThread): void {
		this.gen = open.gen;
		this.through = open.revision;
		this.index = open.index;
		this.lost = open.index.lost;
		this.state = open.state;
		this.delta = [];
		this.newCount = 0;
		this.source = "server";
		this.edges = { before: "idle", after: "idle" };
		this.takePage(open.page, "replace");
		this.emit("replace");
	}

	applyPage(page: ThreadPage, mode: "replace" | "before" | "after"): void {
		this.takePage(page, mode);
		if (mode === "before") this.edges.before = "idle";
		if (mode === "after") this.edges.after = "idle";
		this.emit(
			mode === "before" ? "prepend" : mode === "after" ? "append" : "replace",
		);
	}

	setEdge(edge: "before" | "after", state: EdgeState): void {
		this.edges = { ...this.edges, [edge]: state };
		this.emit("update");
	}

	applyIndex(index: ThreadIndex): void {
		if (index.gen !== this.gen) return;
		this.index = index;
		this.lost = index.lost;
		this.indexStale = false;
		this.emit("update");
	}

	/** A folded turn read whole: its work joins the window. */
	applyTurn(turnKey: string, page: ThreadPage): void {
		if (page.gen !== this.gen) return;
		for (const it of page.items)
			if (!this.items.has(it.key))
				this.remember({
					key: it.key,
					ordinal: it.ordinal,
					event: it.event,
					...(it.cut ? { cut: it.cut } : {}),
				});
		this.folded.delete(turnKey);
		this.emit("update");
	}

	/** One event read whole: its cut fields come back. */
	applyFull(key: string, event: CanonicalEvent): void {
		const it = this.items.get(key);
		if (!it) return;
		this.items.set(key, { key, ordinal: it.ordinal, event });
		this.emit("update");
	}

	/** Whether an incoming event belongs in the window: inside its range, past an open tail, or beside its anchor. */
	private belongs(key: string, event: CanonicalEvent): "in" | "after" | "out" {
		if (this.items.has(key)) return "in";
		const ref = anchorRefOf(event);
		if (ref && this.openers.has(`${ref.kind}#${ref.id}`)) return "in";
		if (!this.lo || !this.hi) return this.hasAfter ? "out" : "in";
		if (compareKeys(key, this.lo) < 0) return "out";
		if (compareKeys(key, this.hi) <= 0) return "in";
		return this.hasAfter ? "after" : "in";
	}

	private take(
		event: CanonicalEvent,
		ordinal: number | null,
	): "in" | "after" | "out" {
		const key = eventKey(event);
		const entry = indexEntryOf(event);
		if (entry && this.index) this.upsertEntry(entry);
		if (turnAuthorOf(event)) this.indexStale = true;
		const where = this.belongs(key, event);
		if (where === "in") {
			const had = this.items.get(key);
			this.remember({
				key,
				ordinal: ordinal ?? had?.ordinal ?? null,
				event,
			});
			if (!this.hi || compareKeys(key, this.hi) > 0) this.hi = key;
			if (!this.lo) this.lo = key;
		} else if (where === "after" && entry) this.newCount++;
		if (!this.delta.some((d) => eventKey(d) === key)) {
			this.delta.push(event);
			if (this.delta.length > DELTA_MAX) this.delta.shift();
		}
		return where;
	}

	private upsertEntry(entry: IndexEntry): void {
		const index = this.index;
		if (!index) return;
		const entries = index.entries;
		const at = entries.findIndex((e) => e[0] === entry[0]);
		if (at >= 0) entries[at] = entry;
		else {
			let i = entries.length;
			while (
				i > 0 &&
				compareKeys((entries[i - 1] as IndexEntry)[0], entry[0]) > 0
			)
				i--;
			entries.splice(i, 0, entry);
			index.total++;
		}
		this.index = { ...index, entries: [...entries] };
	}

	/** A provisional event sent live, before the record stored it. */
	applyLive(gen: number, event: CanonicalEvent): void {
		if (gen !== this.gen) return;
		this.take(event, null);
		this.emit("append");
	}

	/** Committed events and acks: the only thing that moves the cursor. */
	applyCommit(frame: CommitFrame): void {
		if (frame.gen !== this.gen) return;
		for (const { ordinal, event } of frame.events) this.take(event, ordinal);
		for (const [key, ordinal] of frame.acks) {
			const it = this.items.get(key);
			if (it && it.ordinal === null) this.items.set(key, { ...it, ordinal });
		}
		this.through = Math.max(this.through, frame.through);
		this.emit("append");
	}

	/** The stream ended: a provisional event never acked was not saved, and leaves (#1101 cat 12). */
	applyDone(frame: DoneFrame): void {
		if (frame.gen !== this.gen) return;
		this.through = Math.max(this.through, frame.through);
		this.lost = frame.lost;
		let dropped = 0;
		for (const [key, it] of Array.from(this.items))
			if (it.ordinal === null) {
				this.items.delete(key);
				dropped++;
			}
		this.unsaved += dropped;
		this.emit("update");
	}

	clearNew(): void {
		if (this.newCount === 0) return;
		this.newCount = 0;
		this.emit("update");
	}

	/** Committed items only, the snapshot a later visit renders first. */
	snapshot(): WindowSnapshot | null {
		if (!this.index || !this.state || this.gen < 0) return null;
		const all = this.sorted().filter((i) => i.ordinal !== null);
		const items = all.slice(-SNAPSHOT_ITEMS);
		const first = items[0];
		const cutBefore = all.length > items.length;
		return {
			v: 1,
			gen: this.gen,
			through: this.through,
			index: this.index,
			items,
			lo: first?.key ?? this.lo,
			hi: this.hi,
			hasBefore: this.hasBefore || cutBefore,
			hasAfter: this.hasAfter,
			context: this.context,
			folded: Array.from(this.folded.values()),
			state: this.state,
		};
	}

	/** Render a cached window first; `applyOpen` then replaces it with the server's. */
	hydrate(s: WindowSnapshot): void {
		if (this.source !== "none" || s.v !== 1) return;
		this.gen = s.gen;
		this.through = s.through;
		this.index = s.index;
		this.state = s.state;
		this.clearWindow();
		for (const it of s.items) this.remember(it);
		this.lo = s.lo;
		this.hi = s.hi;
		this.hasBefore = s.hasBefore;
		this.hasAfter = s.hasAfter;
		this.context = s.context;
		for (const f of s.folded) this.folded.set(f.turnKey, f);
		this.source = "cached";
		this.emit("replace");
	}
}
