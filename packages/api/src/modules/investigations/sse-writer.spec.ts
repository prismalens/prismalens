// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * SSE backpressure tests.
 *
 * The property under test is that a subscriber's pending frames are BOUNDED. A writer
 * that ignores `write`'s return value has no bound at all — the socket's internal buffer
 * grows until the process dies — and the relay's replay ring buffer does nothing about
 * it, because it bounds replay rather than write pressure.
 */

import { describe, expect, it, vi } from "vitest";
import { BoundedSseWriter, type SseSocket } from "./sse-writer.js";

/** A writable that stops accepting after `acceptUpTo` writes, until `drain()` is called. */
function fakeSocket(acceptUpTo = Number.POSITIVE_INFINITY) {
	const written: string[] = [];
	let accepted = 0;
	let backedUp = false;
	const drainListeners: Array<() => void> = [];
	let ended = false;

	const socket: SseSocket & {
		written: string[];
		drain(): void;
		ended: boolean;
	} = {
		written,
		get ended() {
			return ended;
		},
		write(chunk: string) {
			written.push(chunk);
			accepted++;
			if (accepted >= acceptUpTo) backedUp = true;
			return !backedUp;
		},
		end() {
			ended = true;
		},
		on(_event: "drain", listener: () => void) {
			drainListeners.push(listener);
			return socket;
		},
		off(_event: "drain", listener: () => void) {
			const i = drainListeners.indexOf(listener);
			if (i >= 0) drainListeners.splice(i, 1);
			return socket;
		},
		drain() {
			backedUp = false;
			accepted = 0;
			for (const listener of [...drainListeners]) listener();
		},
	};
	return socket;
}

describe("BoundedSseWriter", () => {
	it("writes straight through while the socket is draining normally", () => {
		const socket = fakeSocket();
		const writer = new BoundedSseWriter(socket);

		writer.send('{"a":1}');
		writer.send('{"a":2}');

		expect(socket.written).toEqual(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']);
		expect(writer.queued).toBe(0);
	});

	it("stops writing and starts queueing once write() returns false", () => {
		// The socket accepts exactly one frame, then reports backpressure.
		const socket = fakeSocket(1);
		const writer = new BoundedSseWriter(socket, { maxQueued: 10 });

		writer.send("one");
		expect(socket.written).toHaveLength(1);

		writer.send("two");
		writer.send("three");

		// Nothing more reached the socket — the return value was respected.
		expect(socket.written).toHaveLength(1);
		expect(writer.queued).toBe(2);
	});

	it("flushes the queue in order on drain, re-pausing whenever the socket backs up again", () => {
		// This socket accepts exactly one frame per drain cycle, so the flush has to stop
		// and re-arm mid-queue — the case a naive `while (queue.length) write()` gets wrong.
		const socket = fakeSocket(1);
		const writer = new BoundedSseWriter(socket, { maxQueued: 10 });

		writer.send("one");
		writer.send("two");
		writer.send("three");
		expect(writer.queued).toBe(2);

		socket.drain();
		expect(socket.written).toEqual(["data: one\n\n", "data: two\n\n"]);
		expect(writer.queued).toBe(1);

		socket.drain();
		expect(socket.written).toEqual([
			"data: one\n\n",
			"data: two\n\n",
			"data: three\n\n",
		]);
		expect(writer.queued).toBe(0);
	});

	it("BOUNDS the queue: a lagging subscriber is dropped instead of buffering without limit", () => {
		const socket = fakeSocket(1);
		const onLag = vi.fn();
		const writer = new BoundedSseWriter(socket, { maxQueued: 3, onLag });

		writer.send("accepted");
		// Fill the bound exactly.
		for (let i = 0; i < 3; i++) writer.send(`queued-${i}`);
		expect(writer.queued).toBe(3);

		// One frame past the bound.
		writer.send("overflow");

		expect(onLag).toHaveBeenCalledTimes(1);
		expect(writer.isLagged).toBe(true);
		expect(writer.isClosed).toBe(true);
		expect(socket.ended).toBe(true);
		// The queue is discarded, not retained — the whole point of the bound.
		expect(writer.queued).toBe(0);
	});

	it("tells the dropped subscriber to resync before disconnecting it", () => {
		const socket = fakeSocket(1);
		const writer = new BoundedSseWriter(socket, { maxQueued: 1 });

		writer.send("accepted");
		writer.send("queued");
		writer.send("overflow");

		const last = socket.written.at(-1) as string;
		expect(last).toContain("event: lag");
		expect(last).toContain("resync from the durable event record");
	});

	it("never grows past the bound, however long the flood runs", () => {
		const socket = fakeSocket(1);
		const writer = new BoundedSseWriter(socket, { maxQueued: 5 });

		writer.send("accepted");
		for (let i = 0; i < 10_000; i++) writer.send(`event-${i}`);

		expect(writer.queued).toBe(0);
		expect(writer.isLagged).toBe(true);
		// One accepted frame plus the terminal lag frame — nothing else was buffered.
		expect(socket.written).toHaveLength(2);
	});

	it("ignores sends after close, and close is idempotent", () => {
		const socket = fakeSocket();
		const writer = new BoundedSseWriter(socket);

		writer.send("one");
		writer.close();
		writer.close();
		writer.send("two");

		expect(socket.written).toEqual(["data: one\n\n"]);
		expect(writer.isClosed).toBe(true);
	});

	it("emits the exact frame shape Nest's @Sse() produced, so clients are unaffected", () => {
		const socket = fakeSocket();
		const writer = new BoundedSseWriter(socket);

		writer.send(JSON.stringify({ type: "done" }));

		expect(socket.written).toEqual(['data: {"type":"done"}\n\n']);
	});
});
