// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter, on } from "node:events";
import type { LiveChange, LiveTopic } from "@prismalens/contracts";

/** Which list a write to each Prisma model changes; models not listed change none. */
const TOPIC_BY_MODEL: Readonly<Record<string, LiveTopic>> = {
	Incident: "incidents",
	TimelineEntry: "incidents",
	Alert: "alerts",
	AlertSourceAlert: "alerts",
	Investigation: "investigations",
};

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
 * that writes ten rows wakes each browser once.
 */
export class LiveChanges {
	private readonly emitter = new EventEmitter();
	private pending = new Set<LiveTopic>();
	private timer: NodeJS.Timeout | null = null;

	constructor(private readonly windowMs = 250) {
		this.emitter.setMaxListeners(0);
	}

	noteWrite(model: string | undefined, operation: string): void {
		const topic = model ? TOPIC_BY_MODEL[model] : undefined;
		if (!topic || !WRITE_OPERATIONS.has(operation)) return;
		this.pending.add(topic);
		this.timer ??= setTimeout(() => this.flush(), this.windowMs);
		this.timer.unref?.();
	}

	/** Yields every change from now until `signal` aborts. */
	async *subscribe(signal?: AbortSignal): AsyncGenerator<LiveChange> {
		try {
			for await (const [change] of on(this.emitter, "change", { signal })) {
				yield change as LiveChange;
			}
		} catch (error) {
			if (!signal?.aborted) throw error;
		}
	}

	private flush(): void {
		this.timer = null;
		if (this.pending.size === 0) return;
		const topics = [...this.pending];
		this.pending = new Set();
		this.emitter.emit("change", { topics } satisfies LiveChange);
	}
}

/** One per process: every write goes through the one Prisma client. */
export const liveChanges = new LiveChanges();
