// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const EVENT = "pl:compose";

/** Puts a question in the thread's composer and focuses it; empty text only focuses. */
export function compose(text: string): void {
	window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
}

/** The composer's side: called with the text a card asked it to hold. */
export function onCompose(handler: (text: string) => void): () => void {
	const listen = (e: Event) => handler((e as CustomEvent<string>).detail);
	window.addEventListener(EVENT, listen);
	return () => window.removeEventListener(EVENT, listen);
}
