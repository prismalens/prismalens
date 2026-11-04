// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import type { LiveChange, LiveTopic } from "@prismalens/contracts";

/** Which list a write to each Prisma model changes; models not listed change none. */
const TOPIC_BY_MODEL: Readonly<Record<string, LiveTopic>> = {
	Incident: "incidents",
	TimelineEntry: "incidents",
	Alert: "alerts",
	AlertSourceAlert: "alerts",
	Investigation: "investigations",
	InvestigationEvent: "threads",
	Schedule: "schedules",
	ScheduleTick: "schedules",
	// A ticked Do now step is shared across browsers (study-v3 §3.2).
	Recommendation: "incidents",
};

/** An agent's events come fast; the thread list re-reads for them at most once per slower window. */
const SLOW_TOPICS: ReadonlySet<LiveTopic> = new Set(["threads"]);

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

/**
 * Collects change hints and sends them at most once per window, so a webhook
 * that writes ten rows wakes each browser once. A slow subscriber holds at
 * most one pending set of topics, never a queue (#776 review).
 */
export class LiveChanges {
	private readonly emitter = new EventEmitter();
	private readonly transaction = new AsyncLocalStorage<[string, string][]>();
	private readonly batches = new Map<number, Set<LiveTopic>>();

	constructor(
		private readonly windowMs = 250,
		private readonly slowMs = 1_000,
	) {
		this.emitter.setMaxListeners(0);
	}

	noteWrite(model: string | undefined, operation: string): void {
		const deferred = this.transaction.getStore();
		if (deferred && model) {
			deferred.push([model, operation]);
			return;
		}
		const topic = model ? TOPIC_BY_MODEL[model] : undefined;
		if (!topic || !WRITE_OPERATIONS.has(operation)) return;
		this.noteTopic(topic);
	}

	/** For a write to a shared model (Setting) that only one list reads. */
	noteTopic(topic: LiveTopic): void {
		const ms = SLOW_TOPICS.has(topic) ? this.slowMs : this.windowMs;
		let batch = this.batches.get(ms);
		if (!batch) {
			batch = new Set();
			this.batches.set(ms, batch);
			setTimeout(() => this.flush(ms), ms).unref?.();
		}
		batch.add(topic);
	}

	/**
	 * Runs a transaction, holding the writes it notes until it commits; a
	 * rollback sends nothing, so a browser never refetches before the rows exist.
	 */
	async afterCommit<T>(run: () => Promise<T>): Promise<T> {
		const writes: [string, string][] = [];
		const result = await this.transaction.run(writes, run);
		for (const [model, operation] of writes) this.noteWrite(model, operation);
		return result;
	}

	/** Yields every change from now until `signal` aborts, merging any it has not yet taken. */
	async *subscribe(signal?: AbortSignal): AsyncGenerator<LiveChange> {
		let waiting = new Set<LiveTopic>();
		let wake: (() => void) | null = null;
		const listener = (change: LiveChange) => {
			for (const topic of change.topics) waiting.add(topic);
			wake?.();
		};
		const stop = () => wake?.();
		this.emitter.on("change", listener);
		signal?.addEventListener("abort", stop, { once: true });
		try {
			while (!signal?.aborted) {
				if (waiting.size === 0) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					wake = null;
					continue;
				}
				const topics = [...waiting];
				waiting = new Set();
				yield { topics };
			}
		} finally {
			this.emitter.off("change", listener);
			signal?.removeEventListener("abort", stop);
		}
	}

	private flush(ms: number): void {
		const batch = this.batches.get(ms);
		this.batches.delete(ms);
		if (!batch?.size) return;
		this.emitter.emit("change", { topics: [...batch] } satisfies LiveChange);
	}
}

/** One per process: every write goes through the one Prisma client. */
export const liveChanges = new LiveChanges();
