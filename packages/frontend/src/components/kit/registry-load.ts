// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";

type Registry = typeof import("./registry");

let registry: Registry | null = null;
let pending: Promise<Registry> | null = null;
const waiting = new Set<() => void>();

/**
 * Loads the registry: every action, surface and setting, with their icons and code. A page's
 * first frame draws without it and it loads after the first content (#1101 category 12).
 */
export function loadRegistry(): Promise<Registry> {
	pending ??= import("./registry").then((m) => {
		registry = m;
		waiting.forEach((wake) => {
			wake();
		});
		return m;
	});
	return pending;
}

/** Unit tests render a surface in one pass: their setup hands the registry over first. */
export function primeRegistry(m: Registry): void {
	registry = m;
}

const subscribe = (wake: () => void) => {
	waiting.add(wake);
	return () => {
		waiting.delete(wake);
	};
};
export const registryNow = () => registry;

/** The registry once it has loaded; null before, when a surface draws its stand-in. */
export function useRegistry(): Registry | null {
	return useSyncExternalStore(subscribe, registryNow, registryNow);
}
