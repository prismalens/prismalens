// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Fixture } from "./fixture.js";

/** One normalised event, stamped on arrival so liveness can be measured. */
export interface GateEvent {
	t: number;
	kind: "text" | "delta" | "tool" | "permission";
	/** Tool call id, when the transport gives one. */
	id?: string;
	name?: string;
	status?: string;
	input?: string;
	output?: string;
	/** Set when the event belongs to a sub-agent spawned by another tool call. */
	parentId?: string;
	/** Permission request text: tool or title plus its input. */
	request?: string;
}

export interface TurnResult {
	/** The turn reached a stop on its own (or after a cancel), rather than timing out. */
	settled: boolean;
	/** The stop reason reported was a normal end of turn. */
	ended: boolean;
	text: string;
	error?: string;
}

export interface GateSession {
	readonly events: GateEvent[];
	prompt(text: string, timeoutMs: number): Promise<TurnResult>;
	cancel(): Promise<void>;
	close(): Promise<void>;
}

export interface GateOptions {
	model: string;
	baseUrl: string;
	/** Apply the setting that keeps repo-supplied config inert (R4). */
	isolate: boolean;
	timeoutMs: number;
}

export interface Driver {
	id: string;
	/** The settings a passing run needs, recorded beside the result. */
	config(opts: GateOptions): Record<string, unknown>;
	versions(): Record<string, string>;
	open(fx: Fixture, opts: GateOptions): Promise<GateSession>;
}

/** prismalens's read-only policy as the gate applies it: reads and the probe tool pass, everything else is refused. */
export const allowed = (request: string, kind?: string) =>
	/prismalens_probe/.test(request) || kind === "read";

export const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export function withTimeout<T>(
	work: Promise<T>,
	ms: number,
	onTimeout: T,
): Promise<T> {
	return Promise.race([work, sleep(ms).then(() => onTimeout)]);
}

/** A push-driven async iterable, for SDKs that take a stream of user messages. */
export class Inbox<T> implements AsyncIterable<T> {
	private items: T[] = [];
	private waiting?: (r: IteratorResult<T>) => void;
	private done = false;

	push(item: T) {
		if (this.waiting) {
			this.waiting({ value: item, done: false });
			this.waiting = undefined;
		} else this.items.push(item);
	}

	end() {
		this.done = true;
		this.waiting?.({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				const item = this.items.shift();
				if (item !== undefined)
					return Promise.resolve({ value: item, done: false });
				if (this.done) return Promise.resolve({ value: undefined, done: true });
				return new Promise((resolve) => {
					this.waiting = resolve;
				});
			},
		};
	}
}
