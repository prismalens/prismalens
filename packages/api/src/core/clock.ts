// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The one door to the wall clock and to timers in API product code (#1154), so a test that fakes
// time controls all of it. Each call reads the global at call time: capturing it at import would
// pin the real timers before `vi.useFakeTimers()` replaces them.
// Biome's `no-direct-clock` rule forbids the direct calls everywhere else.

/** Epoch milliseconds. */
export const now = (): number => Date.now();

/** The current instant as a new `Date`. */
export const date = (): Date => new Date();

export const setTimeout = (
	...args: Parameters<typeof globalThis.setTimeout>
): ReturnType<typeof globalThis.setTimeout> => globalThis.setTimeout(...args);

export const setInterval = (
	...args: Parameters<typeof globalThis.setInterval>
): ReturnType<typeof globalThis.setInterval> => globalThis.setInterval(...args);

export const clearInterval = (
	...args: Parameters<typeof globalThis.clearInterval>
): void => globalThis.clearInterval(...args);

/** Resolves after `ms`. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
