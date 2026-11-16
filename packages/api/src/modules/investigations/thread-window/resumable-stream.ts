// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	type CommitFrame,
	eventKey,
	isWorkflowTerminal,
	rowKey,
} from "@prismalens/contracts";

/** Live events held while the gap replays; past this the client reloads its window instead. */
export const REPLAY_BUFFER_EVENTS = 1_000;
export const REPLAY_BUFFER_BYTES = 4 * 1024 * 1024;
/** A pull while subscribed even without a ping: a missed ping costs this much delay, never a gap. */
export const PULL_TICK_MS = 5_000;
/** Keys remembered as sent, live or committed, per subscriber. */
const SENT_KEYS = 5_000;

export interface StreamSource {
	head(
		threadId: string,
	): Promise<{ gen: number; revision: number; lost: number; status: string }>;
	rows(
		threadId: string,
		after: number,
		through: number,
	): AsyncIterable<
		{ seq: number; branchId: string; ordinal: number; event: string }[]
	>;
	parseRow(threadId: string, raw: string): CanonicalEvent | null;
	/** Live events and the relay's terminal outcome; the same contract as StreamRelayService.subscribe. */
	subscribe(
		threadId: string,
		onEvent: (event: CanonicalEvent) => void,
		onDone: () => void,
		onUnknown: () => void,
	): { unsubscribe: () => void };
	onCommit(
		threadId: string,
		fn: (what: "commit" | "reset") => void,
	): () => void;
}

export interface StreamSink {
	send(name: string, data: unknown, id?: string): void;
	/** `clean`: the stream reached its end; otherwise the client reconnects. */
	close(clean: boolean): void;
}

class BoundedKeys {
	private readonly keys = new Set<string>();
	add(key: string): void {
		this.keys.add(key);
		if (this.keys.size > SENT_KEYS) {
			const oldest = this.keys.values().next().value;
			if (oldest !== undefined) this.keys.delete(oldest);
		}
	}
	has(key: string): boolean {
		return this.keys.has(key);
	}
	delete(key: string): boolean {
		return this.keys.delete(key);
	}
}

/**
 * One subscriber of a thread's resumable stream (#1101 cat 12). It subscribes before
 * it reads, replays committed rows past the client's cursor up to a watermark, drains
 * what arrived meanwhile, then streams live. The cursor only moves on commit frames.
 */
export class ResumableStream {
	private gen = 0;
	private through = 0;
	private lost = 0;
	private replaying = true;
	private closed = false;
	private buffered: CanonicalEvent[] = [];
	private bufferedBytes = 0;
	private terminal: "done" | "unknown" | null = null;
	private readonly liveSent = new BoundedKeys();
	private readonly committedSent = new BoundedKeys();
	private chain: Promise<void> = Promise.resolve();
	private tick: ReturnType<typeof setInterval> | null = null;
	private unsubscribe: (() => void)[] = [];

	constructor(
		private readonly source: StreamSource,
		private readonly threadId: string,
		private readonly cursor: { gen: number; ordinal: number } | null,
		private readonly sink: StreamSink,
	) {}

	async start(): Promise<void> {
		const relay = this.source.subscribe(
			this.threadId,
			(event) => this.onLive(event),
			() => this.onTerminal("done"),
			() => this.onTerminal("unknown"),
		);
		this.unsubscribe.push(relay.unsubscribe);
		this.unsubscribe.push(
			this.source.onCommit(this.threadId, (what) => {
				if (what === "reset") void this.reset();
				else this.pull();
			}),
		);
		const head = await this.source.head(this.threadId);
		this.gen = head.gen;
		this.lost = head.lost;
		if (this.cursor && this.cursor.gen !== head.gen) return this.reset();
		this.through = this.cursor ? this.cursor.ordinal : head.revision;
		await this.pull();
		this.replaying = false;
		const held = this.buffered;
		this.buffered = [];
		for (const event of held) this.sendLive(event);
		if (this.terminal) return this.finish(this.terminal);
		this.tick = setInterval(() => this.pull(), PULL_TICK_MS);
		this.tick.unref?.();
	}

	stop(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.tick) clearInterval(this.tick);
		for (const off of this.unsubscribe) off();
		this.unsubscribe = [];
	}

	private end(clean: boolean): void {
		if (this.closed) return;
		this.stop();
		this.sink.close(clean);
	}

	private async reset(): Promise<void> {
		const head = await this.source.head(this.threadId);
		this.sink.send("reset", { gen: head.gen });
		this.end(true);
	}

	private onLive(event: CanonicalEvent): void {
		if (this.closed) return;
		if (this.replaying) {
			const size = JSON.stringify(event).length;
			this.buffered.push(event);
			this.bufferedBytes += size;
			if (
				this.buffered.length > REPLAY_BUFFER_EVENTS ||
				this.bufferedBytes > REPLAY_BUFFER_BYTES
			) {
				this.sink.send("resync", { gen: this.gen });
				this.end(true);
			}
			return;
		}
		this.sendLive(event);
		// A writer that publishes after its commit pings no one: its live event does.
		this.pull();
	}

	private sendLive(event: CanonicalEvent): void {
		const key = eventKey(event);
		if (this.committedSent.has(key) || this.liveSent.has(key)) return;
		this.liveSent.add(key);
		this.sink.send("live", { gen: this.gen, event });
	}

	/** Read committed rows past what was sent; serialized, so frames leave in ordinal order. */
	pull(): Promise<void> {
		this.chain = this.chain.then(() => this.pullOnce()).catch(() => {});
		return this.chain;
	}

	private async pullOnce(): Promise<void> {
		if (this.closed) return;
		const head = await this.source.head(this.threadId);
		if (head.gen !== this.gen) return this.reset();
		this.lost = head.lost;
		if (head.revision <= this.through) return;
		for await (const rows of this.source.rows(
			this.threadId,
			this.through,
			head.revision,
		)) {
			if (this.closed) return;
			if (rows.length === 0) continue;
			const frame: CommitFrame = {
				gen: this.gen,
				through: this.through,
				events: [],
				acks: [],
			};
			for (const row of rows) {
				const key = rowKey(row.branchId, row.seq);
				frame.acks.push([key, row.ordinal]);
				frame.through = row.ordinal;
				this.committedSent.add(key);
				if (this.liveSent.delete(key)) continue;
				const event = this.source.parseRow(this.threadId, row.event);
				if (event) frame.events.push({ ordinal: row.ordinal, event });
			}
			this.through = Math.max(this.through, frame.through);
			this.sink.send("commit", frame, `${this.gen}.${this.through}`);
		}
		this.through = Math.max(this.through, head.revision);
	}

	private onTerminal(kind: "done" | "unknown"): void {
		if (this.closed) return;
		if (this.replaying) {
			this.terminal = kind;
			return;
		}
		void this.finish(kind);
	}

	/** End after a final pull, so `through` covers every committed event (#1101 cat 12). */
	private async finish(kind: "done" | "unknown"): Promise<void> {
		await this.pull();
		if (this.closed) return;
		if (kind === "unknown") {
			// No relay buffer: a finished-and-swept run and one mid-restart look alike here; the row decides.
			const head = await this.source.head(this.threadId);
			if (!isWorkflowTerminal(head.status)) return this.end(false);
		}
		this.sink.send("done", {
			gen: this.gen,
			through: this.through,
			lost: this.lost,
		});
		this.end(true);
	}
}
