// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Letters typed before a page's message box exists (#1101 bar 7.16, letters always type):
 * held here, then handed once to whichever box takes them: the stand-in, else the composer.
 */
let held = "";
let taker: ((text: string) => void) | null = null;

export function holdComposeText(text: string): void {
	if (taker) taker(text);
	else held += text;
}

/** The one box that takes held text now and as it comes; returns the release. */
export function takeComposeText(take: (text: string) => void): () => void {
	taker = take;
	if (held) {
		const text = held;
		held = "";
		take(text);
	}
	return () => {
		if (taker === take) taker = null;
	};
}

/** A page whose message box is on its way: a thread, or Home's. */
export const composePage = (path: string) =>
	/^\/threads\/[^/]+\/?$/.test(path) || path === "/new";
