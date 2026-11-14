// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";

export type ThreadSchemas = typeof import("./thread-schemas");

let loaded: ThreadSchemas | null = null;
let pending: Promise<ThreadSchemas> | null = null;
const listeners = new Set<() => void>();

/** The schemas once their chunk has loaded, else null. */
export const threadSchemas = (): ThreadSchemas | null => loaded;

/** Starts the load once; a failed load (a dropped link) tries again on the next call. */
export function loadThreadSchemas(): Promise<ThreadSchemas> {
	pending ??= import("./thread-schemas").then(
		(m) => {
			loaded = m;
			listeners.forEach((l) => {
				l();
			});
			return m;
		},
		(e: unknown) => {
			pending = null;
			throw e;
		},
	);
	return pending;
}

/** For `useSyncExternalStore`: a view that read without the schemas re-derives when they land. */
export function onThreadSchemas(l: () => void): () => void {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** True once the schemas have loaded: a memo that reads reports lists it, to re-derive then. */
export function useThreadSchemasReady(): boolean {
	return useSyncExternalStore(onThreadSchemas, () => loaded !== null);
}
