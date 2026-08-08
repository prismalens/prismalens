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

/** Maximum age for active buffers before forced cleanup (ms) */
const MAX_ACTIVE_BUFFER_AGE_MS = 600_000;

/** Sweep interval for stale active buffers (ms) */
const SWEEP_INTERVAL_MS = 60_000;

interface StreamBuffer {
	events: CanonicalEvent[];
	done: boolean;
	createdAt: number;
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
 */
@Injectable()
export class StreamRelayService implements OnModuleDestroy {
	private readonly logger = new Logger(StreamRelayService.name);
	private readonly emitter = new EventEmitter();
	private readonly buffers = new Map<string, StreamBuffer>();
	private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
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
		// Resetting unconditionally also re-bases `createdAt`, so the stale sweep ages
		// this attempt from its own start rather than the previous one's.
		this.clearCleanupTimer(investigationId);
		// Open the buffer eagerly rather than on the first event: a client that connects
		// between enqueue and the run's first event must see an ACTIVE stream, not an
		// absent one, and `isActive` keys on the buffer's existence.
		this.buffers.set(investigationId, {
			events: [],
			done: false,
			createdAt: Date.now(),
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
			buffer = { events: [], done: false, createdAt: Date.now() };
			this.buffers.set(investigationId, buffer);
		}

		// Ring buffer: keep last BUFFER_SIZE events
		buffer.events.push(event);
		if (buffer.events.length > BUFFER_SIZE) {
			buffer.events.shift();
		}

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
	 * Subscribe to a stream. Replays buffered events, then streams live.
	 *
	 * Attaches live listener BEFORE replaying to prevent gap between
	 * replay and live subscription. Uses a counter to skip events
	 * already delivered during replay.
	 *
	 * @returns Cleanup function to call on unsubscribe
	 */
	subscribe(
		investigationId: string,
		handler: (event: CanonicalEvent) => void,
		onDone: () => void,
	): { unsubscribe: () => void } {
		const buffer = this.buffers.get(investigationId);

		// Snapshot the count of events to replay at subscription time
		const replayCount = buffer?.events.length ?? 0;
		let liveSkipped = 0;

		// Live event handler — skips events already delivered during replay
		const onEvent = (event: CanonicalEvent) => {
			if (liveSkipped < replayCount) {
				liveSkipped++;
				return;
			}
			handler(event);
		};
		const onComplete = () => onDone();

		// Attach live listener FIRST to prevent gap between replay and live
		this.emitter.on(`event:${investigationId}`, onEvent);
		this.emitter.once(`done:${investigationId}`, onComplete);

		// Replay buffered events
		if (buffer) {
			for (const event of buffer.events) {
				handler(event);
			}

			// If stream already completed, clean up listeners and signal done
			if (buffer.done) {
				this.emitter.off(`event:${investigationId}`, onEvent);
				this.emitter.off(`done:${investigationId}`, onComplete);
				setTimeout(() => onDone(), 50);
				return { unsubscribe: () => {} };
			}
		}

		return {
			unsubscribe: () => {
				this.emitter.off(`event:${investigationId}`, onEvent);
				this.emitter.off(`done:${investigationId}`, onComplete);
			},
		};
	}

	/**
	 * Check if a stream is active (has buffer and not done).
	 */
	isActive(investigationId: string): boolean {
		const buffer = this.buffers.get(investigationId);
		return buffer != null && !buffer.done;
	}

	/**
	 * Sweep stale active buffers that were never completed.
	 * Prevents memory leaks from crashed/hung investigations.
	 */
	private sweepStaleBuffers(): void {
		const now = Date.now();
		for (const [id, buffer] of this.buffers) {
			if (!buffer.done && now - buffer.createdAt > MAX_ACTIVE_BUFFER_AGE_MS) {
				this.logger.warn(`Cleaning up stale buffer for investigation ${id}`);
				this.complete(id);
				this.detach(id);
			}
		}
	}
}
