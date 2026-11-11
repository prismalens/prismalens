// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/** localStorage, or null where the browser refuses it (private mode, blocked site data). */
export function storage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

export function readStored<T>(key: string, fallback: T): T {
	try {
		const raw = storage()?.getItem(key);
		return raw == null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

/** False when the write was refused (quota, blocked storage): the caller says "Not saved yet". */
export function writeStored(key: string, value: unknown): boolean {
	try {
		const s = storage();
		if (!s) return false;
		if (value === undefined) s.removeItem(key);
		else s.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

/**
 * State kept per viewer in this browser (#1024): a thread's scroll anchor, its open
 * tool groups, its sent-message history. Storage that throws still renders, unsaved.
 */
export function usePersistedState<T>(
	key: string,
	fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
	const [state, setState] = useState<{ key: string; value: T }>(() => ({
		key,
		value: readStored(key, fallback),
	}));
	// A new key (another thread) reads its own value instead of carrying the last one.
	const current =
		state.key === key ? state.value : readStored<T>(key, fallback);
	useEffect(() => {
		if (state.key !== key) setState({ key, value: readStored(key, fallback) });
	}, [key, state.key, fallback]);
	const set: Dispatch<SetStateAction<T>> = (next) =>
		setState((s) => {
			const base = s.key === key ? s.value : readStored<T>(key, fallback);
			const value =
				typeof next === "function" ? (next as (p: T) => T)(base) : next;
			writeStored(key, value);
			return { key, value };
		});
	return [current, set];
}
