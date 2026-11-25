// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
	LiveChange,
	LiveReset,
	LiveTopic,
	ThreadActivity,
} from "@prismalens/contracts";
import * as clock from "../clock.js";
import { eventShape, NON_AGENT_BRANCHES } from "./step-text.js";

/** Which list a write to each Prisma model changes; models not listed change none. */
const TOPIC_BY_MODEL: Readonly<Record<string, LiveTopic>> = {
	Incident: "incidents",
	TimelineEntry: "incidents",
	Alert: "alerts",
	AlertSourceAlert: "alerts",
	Investigation: "investigations",
	InvestigationEvent: "threads",
	PullRequest: "threads",
	// A thread's panel reads its service and repositories (threads.context).
	Service: "threads",
	ServiceDependency: "threads",
	ServiceRepository: "threads",
	ServiceIntegration: "threads",
	Repository: "threads",
	Schedule: "schedules",
	ScheduleTick: "schedules",
	// A ticked Do now step is shared across browsers (study-v3 §3.2).
	Recommendation: "incidents",
};

/** An agent's events come fast; the thread list re-reads for them at most once per slower window. */
const SLOW_TOPICS: ReadonlySet<LiveTopic> = new Set(["threads"]);

/** Topics whose hint can name the threads it is about. */
const SCOPED_TOPICS: ReadonlySet<LiveTopic> = new Set([
	"threads",
	"investigations",
]);

/**
 * Investigation columns that move no list: activity is read from event rows, and usage only on
 * the thread's own page, so it rides that thread's edges as `detail` (#1181).
 */
const QUIET_FIELDS: ReadonlySet<string> = new Set(["lastActivityAt", "usage"]);

/** A running thread re-reads its lists at most once per this, however fast its agent writes. */
export const EDGE_MS = 10_000;
const RING = 1024;

const WRITE_OPERATIONS = new Set([
	"create",
	"createMany",
	"createManyAndReturn",
	"update",
	"updateMany",
	"updateManyAndReturn",
	"upsert",
	"delete",
	"deleteMany",
]);

type Write = [
	model: string,
	operation: string,
	args?: unknown,
	result?: unknown,
];

interface Pending {
	topics: Set<LiveTopic>;
	scope: Set<string>;
	/** A scoped topic was noted without a thread: the hint is about any thread. */
	anyThread: boolean;
	activity: Map<string, ThreadActivity>;
	detail: Set<string>;
}

interface Edge {
	lastEdge: number;
	dirty: boolean;
	usageDirty: boolean;
	timer?: ReturnType<typeof setTimeout>;
}

const str = (v: unknown): string | undefined =>
	typeof v === "string" ? v : undefined;
const field = (v: unknown, k: string): unknown =>
	v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
const iso = (v: unknown): string | undefined =>
	v instanceof Date ? v.toISOString() : str(v);
const seqOf = (cursor: string): number => Number(cursor.split(".")[1]);

/** Two pending changes as one; the later cursor, each thread's latest activity (#1181). */
export function mergeChanges(a: LiveChange, b: LiveChange): LiveChange {
	const topics = [...new Set([...a.topics, ...b.topics])];
	const scoped = (c: LiveChange) => c.topics.some((t) => SCOPED_TOPICS.has(t));
	const anyThread = [a, b].some((c) => scoped(c) && !c.scope);
	const scope = anyThread
		? undefined
		: [...new Set([...(a.scope ?? []), ...(b.scope ?? [])])];
	const activity = new Map<string, ThreadActivity>();
	for (const x of [...(a.activity ?? []), ...(b.activity ?? [])]) {
		const was = activity.get(x.id);
		if (!was) activity.set(x.id, x);
		else {
			const later = Date.parse(x.at) >= Date.parse(was.at) ? x : was;
			const text = later.text ?? (later === x ? was.text : x.text);
			activity.set(x.id, text ? { ...later, text } : later);
		}
	}
	const detail = [...new Set([...(a.detail ?? []), ...(b.detail ?? [])])];
	return {
		cursor: seqOf(b.cursor) >= seqOf(a.cursor) ? b.cursor : a.cursor,
		topics,
		...(scope?.length ? { scope } : {}),
		...(activity.size ? { activity: [...activity.values()] } : {}),
		...(detail.length ? { detail } : {}),
	};
}

/**
 * Collects change hints and sends them at most once per window, so a webhook
 * that writes ten rows wakes each browser once. Frames carry a cursor and the
 * last 1024 stay in a ring, so a reconnect replays what it missed (#1181).
 */
export class LiveChanges {
	private readonly emitter = new EventEmitter();
	private readonly transaction = new AsyncLocalStorage<Write[]>();
	private readonly batches = new Map<number, Pending>();
	private readonly edges = new Map<string, Edge>();
	private readonly ring: LiveChange[] = [];
	private readonly epoch = randomBytes(4).toString("hex");
	private seq = 0;
	/** Moves on every write except an agent's activity: a shared read keyed by it stays correct. */
	topicVersion = 0;

	constructor(
		private readonly windowMs = 250,
		private readonly slowMs = 1_000,
		private readonly edgeMs = EDGE_MS,
		/** Activity is a small delta the list shows as it lands; half the list hint window keeps it under 2 s. */
		private readonly activityMs = slowMs / 2,
	) {
		this.emitter.setMaxListeners(0);
	}

	cursor(): string {
		return `${this.epoch}.${this.seq}`;
	}

	noteWrite(
		model: string | undefined,
		operation: string,
		args?: unknown,
		result?: unknown,
	): void {
		const deferred = this.transaction.getStore();
		if (deferred && model) {
			deferred.push([model, operation, args, result]);
			return;
		}
		if (!WRITE_OPERATIONS.has(operation)) return;
		const topic = model ? TOPIC_BY_MODEL[model] : undefined;
		if (!topic) {
			// No list hint, but a shared read may hold what it changed (a setting, an ask).
			this.topicVersion++;
			return;
		}
		if (model === "InvestigationEvent") this.noteEvent(operation, args, result);
		else if (model === "Investigation")
			this.noteInvestigation(operation, args, result);
		else this.noteTopic(topic);
	}

	/** For a write to a shared model (Setting) that only one list reads. */
	noteTopic(topic: LiveTopic, thread?: string): void {
		this.topicVersion++;
		const batch = this.batch(
			SLOW_TOPICS.has(topic) ? this.slowMs : this.windowMs,
		);
		batch.topics.add(topic);
		if (!SCOPED_TOPICS.has(topic)) return;
		if (thread) batch.scope.add(thread);
		else batch.anyThread = true;
	}

	/**
	 * Runs a transaction, holding the writes it notes until it commits; a
	 * rollback sends nothing, so a browser never refetches before the rows exist.
	 */
	async afterCommit<T>(run: () => Promise<T>): Promise<T> {
		const writes: Write[] = [];
		const result = await this.transaction.run(writes, run);
		for (const w of writes) this.noteWrite(...w);
		return result;
	}

	/**
	 * Yields every change from now until `signal` aborts, merging any it has not yet taken.
	 * With `after`, first the frames since it, or a reset when the ring no longer holds them.
	 */
	async *subscribe(
		signal?: AbortSignal,
		after?: string,
		sent?: { cursor: string },
	): AsyncGenerator<LiveChange | LiveReset> {
		let waiting: LiveChange | null = null;
		// Registered before the ring is read; what it hears is newer than any replay.
		const floor = this.seq;
		let wake: (() => void) | null = null;
		const listener = (change: LiveChange) => {
			if (seqOf(change.cursor) <= floor) return;
			waiting = waiting ? mergeChanges(waiting, change) : change;
			wake?.();
		};
		const stop = () => wake?.();
		this.emitter.on("change", listener);
		signal?.addEventListener("abort", stop, { once: true });
		const send = <T extends LiveChange | LiveReset>(c: T): T => {
			if (sent) sent.cursor = c.cursor;
			return c;
		};
		try {
			// A generator starts on its first next(): replay from the cursor the caller already gave out.
			const start = after ?? sent?.cursor;
			if (start !== undefined) {
				const [epoch, at] = start.split(".");
				const from = Number(at);
				const oldest = this.ring[0] ? seqOf(this.ring[0].cursor) : this.seq + 1;
				if (
					epoch === this.epoch &&
					Number.isInteger(from) &&
					from >= oldest - 1 &&
					from <= this.seq
				) {
					const missed = this.ring.filter((c) => seqOf(c.cursor) > from);
					if (missed.length) yield send(missed.reduce(mergeChanges));
				} else yield send({ reset: true, cursor: this.cursor() });
			}
			while (!signal?.aborted) {
				const next: LiveChange | null = waiting;
				if (!next) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					wake = null;
					continue;
				}
				waiting = null;
				yield send(next);
			}
		} finally {
			this.emitter.off("change", listener);
			signal?.removeEventListener("abort", stop);
		}
	}

	/** An event row: an agent's output is activity on its thread; anything else re-reads the lists. */
	private noteEvent(operation: string, args: unknown, result: unknown): void {
		const id = str(field(result, "investigationId"));
		const raw = str(field(result, "event"));
		const at = iso(field(result, "createdAt"));
		if (operation !== "create" || !id || raw === undefined || !at) {
			const where = str(field(field(args, "where"), "investigationId"));
			this.noteTopic("threads", where);
			return;
		}
		const { kind, text } = eventShape(raw);
		const branch = str(field(result, "branchId")) ?? "";
		if (
			NON_AGENT_BRANCHES.has(branch) ||
			kind.startsWith("ask_") ||
			kind.startsWith("permission_")
		) {
			this.noteTopic("threads", id);
			return;
		}
		const batch = this.batch(this.activityMs);
		const was = batch.activity.get(id);
		// An event that reaches the hook late never moves the thread's activity back.
		const later = !was || Date.parse(at) >= Date.parse(was.at);
		const kept = later
			? { at, text: text ?? was?.text }
			: { at: was.at, text: was.text ?? text };
		batch.activity.set(id, {
			id,
			at: kept.at,
			...(kept.text ? { text: kept.text } : {}),
		});
		this.touch(id, false);
	}

	/** A thread's own row: activity and usage stay off the lists; a visit moves only the feed. */
	private noteInvestigation(
		operation: string,
		args: unknown,
		result: unknown,
	): void {
		const id =
			operation === "create"
				? str(field(result, "id"))
				: str(field(field(args, "where"), "id"));
		const data = field(args, "data");
		const keys =
			operation === "update" || operation === "updateMany"
				? Object.keys(data && typeof data === "object" ? data : {}).filter(
						(k) => k !== "updatedAt",
					)
				: [];
		if (keys.length && keys.every((k) => k === "lastActivityAt")) return;
		if (keys.length && keys.every((k) => k === "lastVisitedAt")) {
			this.noteTopic("visits");
			this.noteTopic("schedules");
			return;
		}
		if (
			id &&
			keys.includes("usage") &&
			keys.every((k) => QUIET_FIELDS.has(k))
		) {
			// `get` shows usage: a shared read must not hide it until the next edge.
			this.topicVersion++;
			this.touch(id, true);
		} else this.noteTopic("investigations", id);
	}

	/** Activity or usage on a thread: at most one scoped list hint per edge window. */
	private touch(id: string, usage: boolean): void {
		let edge = this.edges.get(id);
		if (!edge) {
			edge = { lastEdge: -Infinity, dirty: false, usageDirty: false };
			this.edges.set(id, edge);
		}
		edge.dirty = true;
		if (usage) edge.usageDirty = true;
		if (clock.now() - edge.lastEdge >= this.edgeMs) this.edge(id, edge);
	}

	private edge(id: string, edge: Edge): void {
		this.noteTopic("threads", id);
		if (edge.usageDirty) this.batch(this.slowMs).detail.add(id);
		edge.lastEdge = clock.now();
		edge.dirty = false;
		edge.usageDirty = false;
		clearTimeout(edge.timer);
		edge.timer = clock.setTimeout(() => {
			edge.timer = undefined;
			if (edge.dirty) this.edge(id, edge);
			else this.edges.delete(id);
		}, this.edgeMs);
		edge.timer.unref?.();
	}

	private batch(ms: number): Pending {
		let batch = this.batches.get(ms);
		if (!batch) {
			batch = {
				topics: new Set(),
				scope: new Set(),
				anyThread: false,
				activity: new Map(),
				detail: new Set(),
			};
			this.batches.set(ms, batch);
			clock.setTimeout(() => this.flush(ms), ms).unref?.();
		}
		return batch;
	}

	private flush(ms: number): void {
		const batch = this.batches.get(ms);
		this.batches.delete(ms);
		if (!batch) return;
		if (!batch.topics.size && !batch.activity.size && !batch.detail.size)
			return;
		this.seq++;
		// Again at send: a read cached in the batch window may predate a later, un-hinted write.
		if (batch.topics.size) this.topicVersion++;
		const scoped = [...batch.topics].some((t) => SCOPED_TOPICS.has(t));
		const change: LiveChange = {
			cursor: this.cursor(),
			topics: [...batch.topics],
			...(scoped && !batch.anyThread && batch.scope.size
				? { scope: [...batch.scope] }
				: {}),
			...(batch.activity.size
				? { activity: [...batch.activity.values()] }
				: {}),
			...(batch.detail.size ? { detail: [...batch.detail] } : {}),
		};
		this.ring.push(change);
		if (this.ring.length > RING) this.ring.shift();
		this.emitter.emit("change", change);
	}
}

/** One per process: every write goes through the one Prisma client. */
export const liveChanges = new LiveChanges();
