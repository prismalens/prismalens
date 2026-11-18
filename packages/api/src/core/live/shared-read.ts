// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Request } from "express";
import { liveChanges } from "./live-changes.js";

const MEMO_MS = 1_000;
const CAP = 64;

interface Entry {
	at: number;
	promise: Promise<unknown>;
}

const memo = new Map<string, Entry>();
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
		memo.clear();
		version = liveChanges.topicVersion;
	}
	const key = JSON.stringify([route, input]);
	const now = Date.now();
	const hit = memo.get(key);
	const fresh = hit && now - hit.at <= MEMO_MS;
	request?.res?.setHeader(
		"server-timing",
		`shared;desc="${fresh ? "hit" : "miss"}"`,
	);
	if (hit && fresh) return hit.promise as Promise<T>;
	if (memo.size >= CAP) memo.delete(memo.keys().next().value as string);
	const promise = run();
	const entry = { at: now, promise };
	memo.set(key, entry);
	promise.catch(() => {
		if (memo.get(key) === entry) memo.delete(key);
	});
	return promise;
}

/** Tests that read one id against two fixtures with no write between. */
export function forgetSharedReads(): void {
	memo.clear();
}
