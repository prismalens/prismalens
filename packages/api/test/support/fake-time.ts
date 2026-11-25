// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { vi } from "vitest";

/**
 * Steps the fake clock until `work` settles, so a retry or a deadline inside it costs no real
 * time. Throws when `work` is still pending after `limitMs` of fake time: it waits on something
 * the clock cannot move.
 */
export async function onFakeTime<T>(
	work: Promise<T>,
	{ stepMs = 250, limitMs = 60_000 } = {},
): Promise<T> {
	let settled = false;
	const done = work.finally(() => {
		settled = true;
	});
	// The caller awaits `done`; this keeps a rejection from being unhandled while the clock steps.
	done.catch(() => {});
	for (let spent = 0; !settled && spent <= limitMs; spent += stepMs)
		await vi.advanceTimersByTimeAsync(stepMs);
	if (!settled)
		throw new Error(`Still pending after ${limitMs} ms of fake time`);
	return done;
}
