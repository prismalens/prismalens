// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The aside's bus, apart from its renderer, so a menu can prime an aside without loading markdown.

export type Listener = (question: string) => void;
/** The open page's overlay, per thread; `AsideHost` adds itself. */
export const listeners = new Map<string, Set<Listener>>();

/** The selection toolbar and `/btw` ask here; the page's overlay answers. */
export function askAside(threadId: string, question: string): boolean {
	const set = listeners.get(threadId);
	const q = question.trim();
	if (!set?.size || !q) return false;
	set.forEach((l) => {
		l(q);
	});
	return true;
}

const primers = new Map<string, Set<() => void>>();

/** Threads primed before their page was open: its composer starts `/btw ` once it mounts. */
const pending = new Set<string>();

/** Ask aside on a selection or from a thread menu: the page starts `/btw ` in its composer. */
export function primeAside(threadId: string) {
	const set = primers.get(threadId);
	if (!set?.size) {
		pending.add(threadId);
		return;
	}
	set.forEach((l) => {
		l();
	});
}

export function onPrimeAside(threadId: string, l: () => void): () => void {
	const set = primers.get(threadId) ?? new Set<() => void>();
	set.add(l);
	primers.set(threadId, set);
	if (pending.delete(threadId)) l();
	return () => {
		set.delete(l);
	};
}

/** `/btw <question>` from the composer, else null. */
export function btwQuestion(text: string): string | null {
	const m = /^\/btw\s+([\s\S]+)$/i.exec(text.trim());
	return m?.[1]?.trim() || null;
}
