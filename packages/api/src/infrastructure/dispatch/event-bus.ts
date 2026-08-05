// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * EventBus — the dispatch-layer fan-out seam that replaced Redis pub/sub.
 *
 * Like {@link ./job-store.js JobStore}, this sits OUTSIDE the engine and is not a port on
 * `conductRun`. It carries the two things Redis pub/sub used to carry besides the queue
 * itself:
 *
 *   1. the **run event relay** — canonical events on their way from a run to the SSE
 *      subscribers (`investigation:events:{id}`), and
 *   2. **cancel** — an out-of-band request that a live run stop
 *      (`investigation:cancel:{id}`).
 *
 * Both are delivered in-process by {@link InProcessEventBus}. A broker driver is an
 * optional cloud concern and is deliberately not built here.
 *
 * `subscriberCount` is load-bearing, not diagnostics: the cancel path needs to know
 * whether ANYONE received the request. Pub/sub has no retention, so zero receivers means
 * nobody will ever act on it and the caller must write the terminal state itself. The
 * in-process bus keeps that semantic identical to the Redis one it replaced.
 */

import type { CanonicalEvent } from "@prismalens/contracts";

export type EventBusHandler<T> = (message: T) => void;

/** Nest DI token for the process's EventBus. */
export const EVENT_BUS = Symbol("PRISMALENS_EVENT_BUS");

/**
 * What travels on a run's relay topic. `done` is the terminal sentinel that closes the
 * SSE stream — the in-process replacement for the `["__done__", {}]` message the Redis
 * relay used to carry.
 */
export type RelayMessage =
	| { kind: "event"; event: CanonicalEvent }
	| { kind: "done" };

export interface EventBus {
	publish<T>(topic: string, message: T): number;
	subscribe<T>(
		topic: string,
		handler: EventBusHandler<T>,
	): { unsubscribe: () => void };
	subscriberCount(topic: string): number;
}

/** The relay topic for one investigation's canonical event stream. */
export function runEventsTopic(investigationId: string): string {
	return `investigation:events:${investigationId}`;
}

/** The out-of-band cancel topic for one investigation. */
export function runCancelTopic(investigationId: string): string {
	return `investigation:cancel:${investigationId}`;
}

/**
 * In-process EventBus over plain Sets of handlers.
 *
 * Deliberately NOT Node's EventEmitter: `setMaxListeners(0)` warnings aside, we need an
 * exact subscriber count per topic and empty topics pruned, and a Map of Sets gives both
 * without fighting the emitter's semantics.
 */
export class InProcessEventBus implements EventBus {
	private readonly topics = new Map<string, Set<EventBusHandler<never>>>();

	publish<T>(topic: string, message: T): number {
		const handlers = this.topics.get(topic);
		if (!handlers || handlers.size === 0) return 0;
		// Snapshot: a handler may unsubscribe itself while we are delivering.
		let delivered = 0;
		for (const handler of [...handlers]) {
			(handler as EventBusHandler<T>)(message);
			delivered++;
		}
		return delivered;
	}

	subscribe<T>(
		topic: string,
		handler: EventBusHandler<T>,
	): { unsubscribe: () => void } {
		let handlers = this.topics.get(topic);
		if (!handlers) {
			handlers = new Set();
			this.topics.set(topic, handlers);
		}
		handlers.add(handler as EventBusHandler<never>);
		return {
			unsubscribe: () => {
				const set = this.topics.get(topic);
				if (!set) return;
				set.delete(handler as EventBusHandler<never>);
				if (set.size === 0) this.topics.delete(topic);
			},
		};
	}

	subscriberCount(topic: string): number {
		return this.topics.get(topic)?.size ?? 0;
	}

	/** Drop every subscription. Shutdown only. */
	clear(): void {
		this.topics.clear();
	}
}
