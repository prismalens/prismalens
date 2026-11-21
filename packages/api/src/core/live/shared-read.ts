// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Request } from "express";
import { liveChanges } from "./live-changes.js";

const MEMO_MS = 1_000;
const CAP = 64;

/** Reads in flight, which every same-key read joins; never evicted, so a join never misses. */
const pending = new Map<string, Promise<unknown>>();
const settled = new Map<string, { at: number; promise: Promise<unknown> }>();
let version = -1;

/**
 * One computation for every tab answering the same hint: a single flight, kept up to 1 s while
 * no topic moves. The key must hold everything the read depends on, the viewer included (#1181).
 */
export function sharedRead<T>(
	route: string,
	input: unknown,
	run: () => Promise<T>,
	request?: Request,
): Promise<T> {
	if (version !== liveChanges.topicVersion) {
		pending.clear();
		settled.clear();
		version = liveChanges.topicVersion;
	}
	const key = JSON.stringify([route, input]);
	const done = settled.get(key);
	const shared =
		pending.get(key) ??
		(done && Date.now() - done.at <= MEMO_MS ? done.promise : undefined);
	request?.res?.setHeader(
		"server-timing",
		`shared;desc="${shared ? "hit" : "miss"}"`,
	);
	if (shared) return shared as Promise<T>;
	const promise = run();
	pending.set(key, promise);
	promise.then(
		() => {
			if (pending.get(key) !== promise) return;
			pending.delete(key);
			settled.delete(key);
			if (settled.size >= CAP)
				settled.delete(settled.keys().next().value as string);
			settled.set(key, { at: Date.now(), promise });
		},
		() => {
			if (pending.get(key) === promise) pending.delete(key);
		},
	);
	return promise;
}

/** Tests that read one id against two fixtures with no write between. */
export function forgetSharedReads(): void {
	pending.clear();
	settled.clear();
}
