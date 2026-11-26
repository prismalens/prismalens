// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/** One toast for another thread's event; the lazy toast layer draws the list. */
export interface AttentionToast {
	id: string;
	title: string;
	body: string;
	threadId: string;
	tone: "default" | "neutral" | "destructive";
	/** From kit `STATUS_DEFS`: two toasts at most, the most urgent kept. */
	urgency: number;
}

let shown: readonly AttentionToast[] = [];
let opener: ((threadId: string, eventId: string) => void) | null = null;
const listeners = new Set<() => void>();

export function setAttentionToasts(
	next: (all: readonly AttentionToast[]) => readonly AttentionToast[],
): void {
	shown = next(shown);
	for (const l of listeners) l();
}

/** How a clicked toast opens its thread: set by the runtime that raises them. */
export function setAttentionOpener(
	open: ((threadId: string, eventId: string) => void) | null,
): void {
	opener = open;
}

export function openAttentionToast(t: AttentionToast): void {
	setAttentionToasts((all) => all.filter((x) => x.id !== t.id));
	opener?.(t.threadId, t.id);
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export const useAttentionToasts = (): readonly AttentionToast[] =>
	useSyncExternalStore(
		subscribe,
		() => shown,
		() => shown,
	);

/**
 * Owns the opener while mounted and returns how to raise a toast. Unmounting takes the
 * toasts it raised with it, since none could open its thread; a later owner's stay.
 */
export function useAttentionToastOwner(
	open: (threadId: string, eventId: string) => void,
): (
	id: string,
	next: (all: readonly AttentionToast[]) => readonly AttentionToast[],
) => void {
	useEffect(() => {
		setAttentionOpener(open);
		return () => setAttentionOpener(null);
	}, [open]);
	const raised = useRef(new Set<string>());
	useEffect(() => {
		const mine = raised.current;
		return () =>
			setAttentionToasts((all) => all.filter((t) => !mine.has(t.id)));
	}, []);
	return useCallback((id, next) => {
		raised.current.add(id);
		setAttentionToasts(next);
	}, []);
}
