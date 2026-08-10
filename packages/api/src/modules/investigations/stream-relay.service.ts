// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter } from "node:events";
import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	EVENT_BUS,
	type EventBus,
	type RelayMessage,
	runEventsTopic,
} from "../../infrastructure/dispatch/event-bus.js";

/** Ring buffer size per investigation */
const BUFFER_SIZE = 50;

/** Time-to-live for buffers after stream completes (ms) */
const BUFFER_TTL_MS = 60_000;

/**
 * How long a relaying run may go SILENT before the relay declares it wedged (ms).
 *
 * Measured from the topic's last proof of life, NOT from when the buffer was opened. As
 * a total-age cap this was a hard ten-minute ceiling on every live stream: the sweep
 * completed and detached a perfectly healthy run at minute ten, its later events
 * published to a topic with no subscribers, and nothing ever re-attached (#371).
 */
const MAX_IDLE_BUFFER_MS = 600_000;

/** Sweep interval for stale active buffers (ms) */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * How long a terminal outcome is deferred for a subscriber that had nothing live to
 * attach to (ms) — the clean `done` of FINISHED and the unclean close of UNKNOWN alike.
 * `subscribe` replays synchronously, so at the moment it decides to close, its return
 * value is not yet in the caller's hands and the caller's writer may not be wired up.
 * One tick out is enough.
 */
const TERMINAL_DELAY_MS = 50;

interface StreamBuffer {
	events: CanonicalEvent[];
	done: boolean;
	/**
	 * Last proof of life for this topic: set when the buffer is opened, bumped by every
	 * event relayed into it. The stale sweep keys on silence since this instant.
	 */
	lastActivityAt: number;
}

/**
 * In-memory event relay for investigation SSE streams.
 *
 * The single source of SSE events. Events arrive on the run's EventBus topic — the
 * in-process replacement for the `investigation:events:{id}` Redis channel — and are
 * fanned out to live subscribers plus a ring buffer (last N events) for late joiners.
 *
 * The ring buffer bounds REPLAY. It says nothing about write pressure on a slow
 * subscriber's socket; that is {@link ../sse-writer.js BoundedSseWriter}'s job, and the
 * two must not be confused for one another.
 *
 * ## Topic state model
 *
 * One investigation id is a TOPIC, and a topic is in exactly one of three states. Every
 * state has a defined terminal outcome — no state leaves a subscriber holding a live
 * subscription that nothing can ever fire:
 *
 * | State        | Relay evidence               | A subscriber receives                        |
 * | ------------ | ---------------------------- | -------------------------------------------- |
 * | **UNKNOWN**  | no buffer for the id         | no frames, then an UNCLEAN close (no `done`) |
 * | **ACTIVE**   | buffer present, `done` false | buffer replay, every live event, then `done` |
 * | **FINISHED** | buffer present, `done` true  | buffer replay, then `done`                   |
 *
 * The three states have two terminal outcomes between them, and which one a subscriber
 * gets is the whole point of the model. `done` is a CLAIM: this topic reached its end and
 * you have seen it. UNKNOWN cannot make that claim — the buffer's absence says only that
 * *this process* has nothing, which a restart or a not-yet-reclaimed run produces just as
 * readily as a genuinely finished one. So UNKNOWN ends the response WITHOUT `done`, and
 * an unclean close is the honest wire signal for "no idea": the browser's `EventSource`
 * raises `onerror`, and the client falls back to the durable record. Routing UNKNOWN
 * through `done` — as this did when the state model first landed (#388) — made a
 * mid-restart client mark a still-running investigation completed, permanently, because
 * on the wire it was byte-identical to FINISHED.
 *
 * One id's whole lifecycle, as the relay sees it:
 *
 * ```text
 *  t+0s   attach("inv-1")                 UNKNOWN  -> ACTIVE   (buffer opened, empty)
 *  t+2s   bus: {kind:"event", e1}         ACTIVE             buffer [e1]
 *  t+3s   subscribe("inv-1")              ACTIVE             replay e1, then live
 *  t+4s   bus: {kind:"event", e2}         ACTIVE             that subscriber gets e2
 *  t+9s   bus: {kind:"done"}              ACTIVE   -> FINISHED  `done` to subscribers,
 *                                                              detach, TTL armed
 *  t+20s  subscribe("inv-1")              FINISHED           replay [e1,e2], then `done`
 *  t+69s  TTL fires                       FINISHED -> UNKNOWN  buffer deleted
 *  t+70s  subscribe("inv-1")              UNKNOWN            no frames, then close, no
 *                                                              `done` — client polls
 * ```
 *
 * The close at t+70s is the fix for #370: that subscribe used to return a live
 * subscription on a topic nothing was publishing to, and the client hung on a frameless
 * 200 until it gave up.
 *
 * The load-bearing rule is that **buffer-absent is a state, not a gap**. It used to mean
 * "assume live": `subscribe` skipped its replay block and handed back a subscription on
 * an emitter that would never fire for that id, so a client connecting after the
 * completed buffer's TTL swept it got a 200 with no frames and no `done`, forever
 * (#370). UNKNOWN now closes. A run whose TTL has expired and a run this process has
 * never heard of are indistinguishable from in here and get the same answer; in both
 * cases the client's recourse is the durable event record, which is complete where this
 * buffer is only the last {@link BUFFER_SIZE} events.
 *
 * ACTIVE is entered by {@link attach} (at enqueue and at claim, before the run's first
 * event) or by {@link emit} opening a buffer under an event with no attach behind it.
 * FINISHED is entered by the run's own `done` sentinel or by the idle sweep. The TTL
 * timer armed at that point takes the topic back to UNKNOWN.
 */
@Injectable()
export class StreamRelayService implements OnModuleDestroy {
	private readonly logger = new Logger(StreamRelayService.name);
	private readonly emitter = new EventEmitter();
	private readonly buffers = new Map<string, StreamBuffer>();
	private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
	/** Deferred terminal-outcome timers for subscribers with nothing live to attach to. */
	private readonly terminalTimers = new Set<NodeJS.Timeout>();
	private readonly sweepInterval: NodeJS.Timeout;
	/** Live EventBus subscriptions, one per attached run. */
	private readonly attached = new Map<string, () => void>();

	constructor(@Inject(EVENT_BUS) private readonly bus: EventBus) {
		// Intentionally unlimited — each SSE client adds 2 listeners
		this.emitter.setMaxListeners(0);

		// Periodic sweep for stale active buffers
		this.sweepInterval = setInterval(
			() => this.sweepStaleBuffers(),
			SWEEP_INTERVAL_MS,
		);
	}

	onModuleDestroy() {
		clearInterval(this.sweepInterval);
		for (const detach of this.attached.values()) detach();
		this.attached.clear();
		this.emitter.removeAllListeners();
		for (const timer of this.cleanupTimers.values()) {
			clearTimeout(timer);
		}
		this.cleanupTimers.clear();
		for (const timer of this.terminalTimers) {
			clearTimeout(timer);
		}
		this.terminalTimers.clear();
		this.buffers.clear();
	}

	/**
	 * Start relaying one run's EventBus topic into this relay. Called when the job is
	 * enqueued and again when it is claimed, so the buffer exists before the run's first
	 * event and before any client connects. Idempotent WHILE attached — a second attach
	 * for a run already relaying is a no-op.
	 *
	 * Once detached, though, a further attach is a NEW run attempt on the same
	 * investigation id (a retry), and it must start from a clean buffer: see below.
	 */
	attach(investigationId: string): void {
		if (this.attached.has(investigationId)) return;

		// A previous attempt's buffer must NOT be carried into this one. It is `done`,
		// its events belong to the old attempt, and its TTL cleanup is already ticking.
		// Reusing it makes `isActive` report a live run as finished, replays the old
		// attempt's events plus an immediate `done` to every client that connects during
		// this one, and lets the old cleanup timer delete this attempt's buffer mid-run.
		// Resetting unconditionally also re-bases `lastActivityAt`, so the stale sweep
		// measures this attempt's silence from its own start, not the previous one's.
		this.clearCleanupTimer(investigationId);
		// Open the buffer eagerly rather than on the first event: a client that connects
		// between enqueue and the run's first event must see an ACTIVE stream, not an
		// absent one, and both `isActive` and `subscribe` key on the buffer's existence.
		this.buffers.set(investigationId, {
			events: [],
			done: false,
			lastActivityAt: Date.now(),
		});
		const { unsubscribe } = this.bus.subscribe<RelayMessage>(
			runEventsTopic(investigationId),
			(message) => {
				if (message.kind === "done") {
					this.complete(investigationId);
					this.detach(investigationId);
					return;
				}
				this.emit(investigationId, message.event);
			},
		);
		this.attached.set(investigationId, unsubscribe);
	}

	/** Stop relaying a run's topic. */
	detach(investigationId: string): void {
		this.attached.get(investigationId)?.();
		this.attached.delete(investigationId);
	}

	/**
	 * Cancel a pending buffer-cleanup timer, if any. Every scheduler of that timer goes
	 * through here first, so the map never holds a handle that nobody can clear.
	 */
	private clearCleanupTimer(investigationId: string): void {
		const timer = this.cleanupTimers.get(investigationId);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.cleanupTimers.delete(investigationId);
	}

	/**
	 * Emit a stream event for an investigation.
	 * Buffers the event and broadcasts to live subscribers.
	 */
	emit(investigationId: string, event: CanonicalEvent): void {
		let buffer = this.buffers.get(investigationId);
		if (!buffer) {
			buffer = { events: [], done: false, lastActivityAt: Date.now() };
			this.buffers.set(investigationId, buffer);
		}

		// Ring buffer: keep last BUFFER_SIZE events
		buffer.events.push(event);
		if (buffer.events.length > BUFFER_SIZE) {
			buffer.events.shift();
		}
		// Proof of life for the idle sweep: a run that is still emitting is not wedged,
		// however long it has been going.
		buffer.lastActivityAt = Date.now();

		this.emitter.emit(`event:${investigationId}`, event);
	}

	/**
	 * Mark a stream as complete. Late-joining subscribers will get
	 * buffered events followed by an immediate done signal.
	 */
	complete(investigationId: string): void {
		const buffer = this.buffers.get(investigationId);
		if (buffer) {
			buffer.done = true;
		}

		this.emitter.emit(`done:${investigationId}`);
		this.logger.debug(`Stream completed for investigation ${investigationId}`);

		// Schedule buffer cleanup. Clear any timer already pending for this id first —
		// `complete` is reachable twice for one attempt (the run's own `done` racing the
		// stale sweep), and overwriting the map entry would strand the earlier handle
		// with nothing left able to clear it.
		this.clearCleanupTimer(investigationId);
		const timer = setTimeout(() => {
			this.buffers.delete(investigationId);
			this.cleanupTimers.delete(investigationId);
		}, BUFFER_TTL_MS);
		this.cleanupTimers.set(investigationId, timer);
	}

	/**
	 * Subscribe to a stream, dispatching on the topic's state (see the class doc).
	 *
	 * - **UNKNOWN** — nothing is relaying this id and nothing will publish on its topic,
	 *   so the subscriber is ended via `onUnknown` rather than parked on an emitter that
	 *   cannot fire. `onDone` is deliberately NOT called: see the class doc on why the two
	 *   terminal outcomes must stay distinguishable on the wire.
	 * - **FINISHED** — the retained buffer IS the whole stream: replay it, then `onDone`.
	 * - **ACTIVE** — replay the buffer, then stream live until the run's `done`.
	 *
	 * There is deliberately no duplicate suppression between replay and live delivery.
	 * The listener registration and the replay loop below are one synchronous run of
	 * this function — nothing awaits, and the emitter is driven from the same thread —
	 * so no event can arrive partway through the replay and be delivered twice. The
	 * positional `liveSkipped < replayCount` counter that used to guard that impossible
	 * gap never skipped a duplicate; it swallowed the first N genuinely new live events
	 * of every late joiner (#369). If identity-keyed suppression is ever needed, it
	 * belongs on the event's `(branchId, seq)`, not on a count.
	 *
	 * @param onDone Terminal outcome for ACTIVE and FINISHED: the topic reached its end
	 *   and this subscriber saw it. The caller may claim a clean stop.
	 * @param onUnknown Terminal outcome for UNKNOWN: end the subscriber WITHOUT claiming
	 *   the stream finished. Separate from `onDone`, and required, so that no caller can
	 *   collapse the two onto one wire frame by omission — which is exactly the defect
	 *   this parameter exists to prevent (#388).
	 * @returns Cleanup function to call on unsubscribe
	 */
	subscribe(
		investigationId: string,
		handler: (event: CanonicalEvent) => void,
		onDone: () => void,
		onUnknown: () => void,
	): { unsubscribe: () => void } {
		const buffer = this.buffers.get(investigationId);

		// UNKNOWN — never relayed here, or relayed and since TTL-swept.
		if (!buffer) return this.closeWithoutStream(onUnknown);

		// FINISHED — replay what is left of the buffer, then close. No listener is
		// registered at all: the emitter's `done` for this topic already fired.
		if (buffer.done) {
			for (const event of buffer.events) handler(event);
			return this.closeWithoutStream(onDone);
		}

		// ACTIVE.
		const onEvent = (event: CanonicalEvent) => handler(event);
		const onComplete = () => onDone();
		this.emitter.on(`event:${investigationId}`, onEvent);
		this.emitter.once(`done:${investigationId}`, onComplete);

		for (const event of buffer.events) handler(event);

		return {
			unsubscribe: () => {
				this.emitter.off(`event:${investigationId}`, onEvent);
				this.emitter.off(`done:${investigationId}`, onComplete);
			},
		};
	}

	/**
	 * End a subscription that has no live stream behind it, deferring its terminal
	 * outcome by {@link TERMINAL_DELAY_MS} so the caller can finish wiring its writer
	 * first. The returned `unsubscribe` cancels it — a client that disconnects inside
	 * that window must not have the outcome run against a closed response.
	 *
	 * WHICH outcome is the caller's to pick: FINISHED passes its `onDone`, UNKNOWN its
	 * `onUnknown`. This helper is deliberately agnostic — it schedules and cancels, and
	 * knows nothing about what the topic is claiming.
	 */
	private closeWithoutStream(end: () => void): { unsubscribe: () => void } {
		const timer = setTimeout(() => {
			this.terminalTimers.delete(timer);
			end();
		}, TERMINAL_DELAY_MS);
		this.terminalTimers.add(timer);
		return {
			unsubscribe: () => {
				clearTimeout(timer);
				this.terminalTimers.delete(timer);
			},
		};
	}

	/**
	 * Whether the topic is in the ACTIVE state: a buffer is open for it and no terminal
	 * `done` has been recorded. UNKNOWN and FINISHED both report false.
	 */
	isActive(investigationId: string): boolean {
		const buffer = this.buffers.get(investigationId);
		return buffer != null && !buffer.done;
	}

	/**
	 * Sweep buffers for runs that have gone SILENT, so a crashed or wedged run cannot
	 * hold a buffer and a bus subscription forever.
	 *
	 * Keyed on time since the topic's last event, never on the buffer's total age. Age
	 * made {@link MAX_IDLE_BUFFER_MS} a hard cap on stream LENGTH — an investigation
	 * still happily emitting at minute ten had its stream completed and detached under
	 * it, and since `attach` only runs at enqueue and at claim, nothing re-attached
	 * (#371). Silence is the only wedged-run evidence this process has locally; a run
	 * that is still publishing is by definition not wedged, however long it runs.
	 */
	private sweepStaleBuffers(): void {
		const now = Date.now();
		for (const [id, buffer] of this.buffers) {
			if (buffer.done) continue;
			if (now - buffer.lastActivityAt <= MAX_IDLE_BUFFER_MS) continue;
			this.logger.warn(
				`Cleaning up idle buffer for investigation ${id} — no relay traffic for ${MAX_IDLE_BUFFER_MS}ms`,
			);
			this.complete(id);
			this.detach(id);
		}
	}
}
