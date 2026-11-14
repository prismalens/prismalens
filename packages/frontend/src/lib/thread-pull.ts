// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const EVENT = "pl:pull-thread";

/** Asks an open thread page to read events committed while no run streams them. */
export function pullThread(threadId: string): void {
	window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: threadId }));
}

/** The thread page's side: called with the thread a write landed on. */
export function onPullThread(handler: (threadId: string) => void): () => void {
	const listen = (e: Event) => handler((e as CustomEvent<string>).detail);
	window.addEventListener(EVENT, listen);
	return () => window.removeEventListener(EVENT, listen);
}
