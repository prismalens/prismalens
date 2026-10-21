// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function tick() {
	now = Date.now();
	listeners.forEach((l) => {
		l();
	});
	timer = setTimeout(tick, 1000 - (now % 1000));
}

/** One timeout for every subscriber, aligned to whole seconds; none while nobody reads the clock. */
export function subscribeClock(listener: () => void): () => void {
	listeners.add(listener);
	if (listeners.size === 1) {
		now = Date.now();
		timer = setTimeout(tick, 1000 - (now % 1000));
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		clearTimeout(timer);
		timer = undefined;
	};
}

export function clockNow(): number {
	return now;
}

/**
 * The current time on a shared one-second clock (#874), for a leaf that shows
 * a live count. Null on the server, like `useNow`.
 */
export function useSecondClock(): number | null {
	return useSyncExternalStore(subscribeClock, clockNow, () => null);
}
