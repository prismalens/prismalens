// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * StreamRelayService tests.
 *
 * The property that carries the most weight here is that ONE investigation id can be
 * relayed MORE THAN ONCE. `attach` is called when a job is enqueued and again when it is
 * claimed, so a retried run re-attaches an id whose previous attempt already completed.
 * Everything the relay exposes — `isActive`, replay, the `done` sentinel, the TTL
 * cleanup timer — is keyed on a per-id buffer, so an attempt that inherits its
 * predecessor's buffer is wrong in every one of those directions at once.
 *
 * The bus is the real {@link InProcessEventBus}: the relay's whole job is what it does
 * with what arrives on that topic, and a hand-rolled double would only re-describe it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	InProcessEventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";
import { StreamRelayService } from "./stream-relay.service.js";

const ID = "inv-1";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

/** Buffer size the relay bounds replay at. Mirrors BUFFER_SIZE. */
const BUFFER_SIZE = 50;
/** Buffer TTL after a stream completes. Mirrors BUFFER_TTL_MS. */
const BUFFER_TTL_MS = 60_000;
/** Age at which an unfinished buffer is swept. Mirrors MAX_ACTIVE_BUFFER_AGE_MS. */
const MAX_ACTIVE_BUFFER_AGE_MS = 600_000;
/** Sweep tick. Mirrors SWEEP_INTERVAL_MS. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * An `error` event — the narrowest shape in the canonical union, so `text` carries the
 * marker identifying which attempt produced it without any other field getting in the way.
 */
function event(text: string, seq = 0): CanonicalEvent {
	return {
		kind: "error",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq,
		ts: new Date(0).toISOString(),
		message: text,
	};
}

/** The marker back out, without casting. */
function marker(e: CanonicalEvent): string {
	return e.kind === "error" ? e.message : e.kind;
}

describe("StreamRelayService", () => {
	let bus: InProcessEventBus;
	let relay: StreamRelayService;

	/** Push an event onto the run's relay topic, the way a live run does. */
	function publish(text: string, seq = 0, id = ID): void {
		bus.publish<RelayMessage>(runEventsTopic(id), {
			kind: "event",
			event: event(text, seq),
		});
	}

	/** Push the terminal sentinel that closes the stream. */
	function publishDone(id = ID): void {
		bus.publish<RelayMessage>(runEventsTopic(id), { kind: "done" });
	}

	/** Subscribe and collect what the subscriber actually receives. */
	function collect(id = ID) {
		const events: string[] = [];
		const onDone = vi.fn();
		const subscription = relay.subscribe(
			id,
			(e) => events.push(marker(e)),
			onDone,
		);
		return { events, onDone, ...subscription };
	}

	beforeEach(() => {
		// Fake timers before construction: the service arms its sweep interval in the
		// constructor, and the TTL cleanup this suite asserts on is minutes out.
		vi.useFakeTimers();
		bus = new InProcessEventBus();
		relay = new StreamRelayService(bus);
	});

	afterEach(() => {
		relay.onModuleDestroy();
		vi.useRealTimers();
	});

	describe("a single run", () => {
		it("delivers live events to a subscriber that joined before the first event", () => {
			relay.attach(ID);
			const sub = collect();

			publish("a1", 0);
			publish("a2", 1);

			expect(sub.events).toEqual(["a1", "a2"]);
			expect(sub.onDone).not.toHaveBeenCalled();
		});

		it("replays the buffer to a late joiner, then closes the stream with done", () => {
			relay.attach(ID);
			publish("a1", 0);
			publish("a2", 1);

			const sub = collect();

			expect(sub.events).toEqual(["a1", "a2"]);
			expect(sub.onDone).not.toHaveBeenCalled();
			expect(relay.isActive(ID)).toBe(true);

			publishDone();

			expect(sub.onDone).toHaveBeenCalledOnce();
			expect(relay.isActive(ID)).toBe(false);
		});

		it("replays to a subscriber that arrives after completion, then signals done", () => {
			relay.attach(ID);
			publish("a1", 0);
			publishDone();

			const sub = collect();

			expect(sub.events).toEqual(["a1"]);
			// The done for an already-finished stream is deferred a tick so the caller
			// can wire up its writer before the stream closes under it.
			expect(sub.onDone).not.toHaveBeenCalled();
			vi.advanceTimersByTime(50);
			expect(sub.onDone).toHaveBeenCalledOnce();
		});

		it("stops delivering once the subscriber unsubscribes", () => {
			relay.attach(ID);
			const sub = collect();

			publish("a1", 0);
			sub.unsubscribe();
			publish("a2", 1);
			publishDone();

			expect(sub.events).toEqual(["a1"]);
			expect(sub.onDone).not.toHaveBeenCalled();
		});

		it(`bounds replay at the last ${BUFFER_SIZE} events`, () => {
			relay.attach(ID);
			for (let i = 0; i < BUFFER_SIZE + 10; i++) publish(`e${i}`, i);

			const sub = collect();

			expect(sub.events).toHaveLength(BUFFER_SIZE);
			expect(sub.events[0]).toBe("e10");
			expect(sub.events.at(-1)).toBe(`e${BUFFER_SIZE + 9}`);
		});

		it("opens a buffer for an event that arrives with no attach behind it", () => {
			relay.emit(ID, event("orphan"));

			expect(relay.isActive(ID)).toBe(true);
			expect(collect().events).toEqual(["orphan"]);
		});
	});

	describe("re-attach — a second run attempt on the same investigation id", () => {
		/** Run attempt 1 to completion, leaving its buffer and TTL timer behind. */
		function runAttemptOne(): void {
			relay.attach(ID);
			publish("attempt1", 0);
			publishDone();
		}

		it("is a no-op while the run is still relaying, so a duplicate attach keeps the buffer", () => {
			relay.attach(ID);
			publish("a1", 0);

			relay.attach(ID);

			// The enqueue/claim pair must not cost the run its buffered events, nor
			// leave two subscriptions racing the same topic.
			expect(collect().events).toEqual(["a1"]);
			expect(bus.subscriberCount(runEventsTopic(ID))).toBe(1);
		});

		it("resets the buffer, so attempt 2 subscribers see neither attempt 1's events nor an immediate done", () => {
			runAttemptOne();

			relay.attach(ID);
			publish("attempt2", 0);

			const sub = collect();

			expect(sub.events).toEqual(["attempt2"]);
			// Nothing deferred is waiting to close this subscriber either — the 50ms
			// already-completed path must not have been taken.
			vi.advanceTimersByTime(1_000);
			expect(sub.onDone).not.toHaveBeenCalled();
		});

		it("reports isActive() true for the live second attempt", () => {
			runAttemptOne();
			expect(relay.isActive(ID)).toBe(false);

			relay.attach(ID);

			expect(relay.isActive(ID)).toBe(true);
		});

		it("cancels attempt 1's cleanup timer, so it cannot wipe attempt 2's buffer", () => {
			runAttemptOne();

			// Retry lands partway through attempt 1's TTL window.
			vi.advanceTimersByTime(BUFFER_TTL_MS / 2);
			relay.attach(ID);
			publish("attempt2", 0);

			// Push past the moment attempt 1's cleanup was scheduled for.
			vi.advanceTimersByTime(BUFFER_TTL_MS);

			expect(relay.isActive(ID)).toBe(true);
			expect(collect().events).toEqual(["attempt2"]);
		});

		it("ages the stale sweep from attempt 2's start, not attempt 1's", () => {
			relay.attach(ID);
			// Attempt 1 hangs and is swept, which completes it and schedules its TTL.
			vi.advanceTimersByTime(MAX_ACTIVE_BUFFER_AGE_MS + SWEEP_INTERVAL_MS);
			expect(relay.isActive(ID)).toBe(false);

			relay.attach(ID);
			publish("attempt2", 0);

			// A sweep tick that would have condemned attempt 1's createdAt must leave
			// this attempt alone.
			vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 2);

			expect(relay.isActive(ID)).toBe(true);
			expect(collect().events).toEqual(["attempt2"]);
		});
	});

	describe("cleanup timers", () => {
		it("does not leak a timer when complete() runs twice for one investigation", () => {
			relay.attach(ID);

			relay.complete(ID);
			const pendingAfterFirst = vi.getTimerCount();

			relay.complete(ID);

			// A second complete replaces the pending cleanup rather than orphaning it.
			// Without the clear, the first handle is unreachable and still armed.
			expect(vi.getTimerCount()).toBe(pendingAfterFirst);
		});

		it("drops the buffer once the TTL expires after completion", () => {
			relay.attach(ID);
			publish("a1", 0);
			publishDone();
			expect(collect().events).toEqual(["a1"]);

			vi.advanceTimersByTime(BUFFER_TTL_MS);

			expect(relay.isActive(ID)).toBe(false);
			expect(collect().events).toEqual([]);
		});
	});

	describe("stale sweep", () => {
		it("force-completes a run that never sent done", () => {
			relay.attach(ID);
			publish("a1", 0);
			const sub = collect();

			vi.advanceTimersByTime(MAX_ACTIVE_BUFFER_AGE_MS + SWEEP_INTERVAL_MS);

			expect(sub.onDone).toHaveBeenCalledOnce();
			expect(relay.isActive(ID)).toBe(false);
			// The sweep also drops the relay subscription, so a late event from the
			// hung run cannot resurrect the buffer.
			expect(bus.subscriberCount(runEventsTopic(ID))).toBe(0);
		});

		it("leaves a young unfinished run alone", () => {
			relay.attach(ID);
			publish("a1", 0);

			vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 2);

			expect(relay.isActive(ID)).toBe(true);
		});
	});

	describe("teardown", () => {
		it("onModuleDestroy drops subscriptions, buffers and every pending timer", () => {
			relay.attach(ID);
			publish("a1", 0);
			relay.complete(ID);
			expect(bus.subscriberCount(runEventsTopic(ID))).toBe(1);

			relay.onModuleDestroy();

			expect(bus.subscriberCount(runEventsTopic(ID))).toBe(0);
			expect(relay.isActive(ID)).toBe(false);
			expect(vi.getTimerCount()).toBe(0);
		});
	});
});
