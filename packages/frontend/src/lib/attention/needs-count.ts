// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";

/** Threads that need you now, for the tab title and the app badge (#1101 category 3). */
let count = 0;
const listeners = new Set<() => void>();

export function setNeedsCount(n: number): void {
	if (n === count) return;
	count = n;
	listeners.forEach((l) => {
		l();
	});
}

export function useNeedsCount(): number {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => count,
		() => 0,
	);
}

/** "(3) Checkout errors – PrismaLens". */
export function titleWithCount(title: string | null | undefined, n: number) {
	const base = title ? `${title} – PrismaLens` : "PrismaLens";
	return n > 0 ? `(${n}) ${base}` : base;
}
