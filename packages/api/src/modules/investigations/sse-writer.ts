// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A bounded, backpressure-aware SSE writer.
 *
 * The capacity risk on the investigation stream is WRITE PRESSURE, not session count: a
 * run can emit canonical events faster than a slow client's socket drains. The relay's
 * ring buffer (50 events / 600s) bounds REPLAY and does nothing for this — a writer that
 * ignores `res.write`'s return value simply piles unflushed chunks into the socket's
 * internal buffer until the process runs out of memory.
 *
 * So this writer does three things:
 *
 *   1. **Checks `write`'s return value.** `false` means the kernel/stream buffer is full;
 *      everything after that is queued rather than written, and writing resumes on `drain`.
 *   2. **Bounds the per-subscriber queue.** A fixed number of pending frames, never more.
 *   3. **Disconnects on lag.** When a subscriber overruns the bound it is sent a terminal
 *      `lag` frame and the response is ended. This is licensed, not a compromise: no
 *      consumer may require gap-free live delivery, and the complete record is the durable
 *      one — a lagging client resyncs from `GET /investigations/:id/events` and reconnects.
 *
 * Dropping the SLOW CLIENT is the correct sacrifice. Slowing the run down to match it, or
 * buffering without limit, would let one stalled browser tab degrade every investigation
 * in the process.
 */

/** The subset of a Node writable HTTP response this writer needs. */
export interface SseSocket {
	write(chunk: string): boolean;
	end(): void;
	on(event: "drain", listener: () => void): unknown;
	off(event: "drain", listener: () => void): unknown;
}

export interface SseWriterOptions {
	/** Maximum frames held while the socket is backed up. */
	maxQueued?: number;
	/** Called once when the subscriber is dropped for lagging. */
	onLag?: () => void;
}

/** Frames held per subscriber before it is judged too slow to keep. */
export const DEFAULT_MAX_QUEUED_FRAMES = 100;

export class BoundedSseWriter {
	private readonly queue: string[] = [];
	private readonly maxQueued: number;
	private readonly onLag: (() => void) | undefined;
	private draining = false;
	private closed = false;
	private lagged = false;

	// Detach BEFORE flushing. `flush` re-arms the listener whenever the socket backs up
	// again, so without this the same handler accumulates one registration per
	// pause/drain cycle — a slow client would collect thousands over a long run.
	private readonly onDrain = () => {
		this.socket.off("drain", this.onDrain);
		this.draining = false;
		this.flush();
	};

	constructor(
		private readonly socket: SseSocket,
		options: SseWriterOptions = {},
	) {
		this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED_FRAMES;
		this.onLag = options.onLag;
	}

	/** Number of frames currently waiting on drain. Tests and diagnostics. */
	get queued(): number {
		return this.queue.length;
	}

	/** Whether this subscriber was dropped for lagging. */
	get isLagged(): boolean {
		return this.lagged;
	}

	get isClosed(): boolean {
		return this.closed;
	}

	/** Queue or write one `data:` frame. */
	send(data: string): void {
		this.push(`data: ${data}\n\n`);
	}

	/**
	 * Queue or write a NAMED frame. Named events are invisible to a client using only
	 * `onmessage`, which is deliberate for control frames like `lag`.
	 */
	sendNamed(event: string, data: string): void {
		this.push(`event: ${event}\ndata: ${data}\n\n`);
	}

	private push(frame: string): void {
		if (this.closed) return;

		// Already backed up: everything queues, so order is preserved.
		if (this.draining) {
			if (this.queue.length >= this.maxQueued) {
				this.dropForLag();
				return;
			}
			this.queue.push(frame);
			return;
		}

		if (!this.socket.write(frame)) {
			this.draining = true;
			this.socket.on("drain", this.onDrain);
		}
	}

	private flush(): void {
		while (!this.closed && this.queue.length > 0) {
			const frame = this.queue.shift() as string;
			if (!this.socket.write(frame)) {
				this.draining = true;
				this.socket.on("drain", this.onDrain);
				return;
			}
		}
		if (!this.closed) this.socket.off("drain", this.onDrain);
	}

	/**
	 * The subscriber overran its bound. Discard what is queued (it is stale by
	 * definition), tell it to resync, and disconnect. Best-effort: the terminal frame
	 * goes out unconditionally, since the queue we just discarded is the only thing that
	 * was blocked.
	 */
	private dropForLag(): void {
		this.lagged = true;
		this.queue.length = 0;
		try {
			this.socket.write(
				`event: lag\ndata: ${JSON.stringify({
					type: "lag",
					reason:
						"subscriber fell too far behind; resync from the durable event record",
				})}\n\n`,
			);
		} catch {
			// The socket is already gone — closing below is all that is left to do.
		}
		this.onLag?.();
		this.close();
	}

	/** Stop writing and end the response. Idempotent. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.queue.length = 0;
		this.socket.off("drain", this.onDrain);
		try {
			this.socket.end();
		} catch {
			// Already destroyed.
		}
	}
}
