// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";

/** One shared action: `/context` (composer) and the meter (app) both open the same view (#1024). */
let opened = 0;
const listeners = new Set<() => void>();

export function openContextMeter(): void {
	opened++;
	listeners.forEach((l) => {
		l();
	});
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

/** Bumps on each `openContextMeter()`; the meter opens when it changes. */
export function useContextMeterSignal(): number {
	return useSyncExternalStore(
		subscribe,
		() => opened,
		() => 0,
	);
}
