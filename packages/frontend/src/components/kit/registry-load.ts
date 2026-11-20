// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { startTransition, useEffect, useState } from "react";
import { onFirstContent } from "@/lib/first-paint";

type Registry = typeof import("./registry");

let registry: Registry | null = null;
let pending: Promise<Registry> | null = null;

/**
 * Loads the registry: every action, surface and setting, with their icons and code. A page's
 * first frame draws without it and it loads after the first content (#1101 category 12).
 */
export function loadRegistry(): Promise<Registry> {
	pending ??= import("./registry").then((m) => {
		registry = m;
		return m;
	});
	return pending;
}

/** Unit tests render a surface in one pass: their setup hands the registry over first. */
export function primeRegistry(m: Registry): void {
	registry = m;
}

export const registryNow = () => registry;

/** The registry once it has loaded; null before, when a surface draws its stand-in. */
export function useRegistry(): Registry | null {
	const [now, setNow] = useState(registryNow);
	useEffect(() => {
		if (now) return;
		let live = true;
		// Loads after the page's first content and arrives in a transition: the page's
		// surfaces re-render in slices that yield.
		onFirstContent(() =>
			loadRegistry().then(
				(r) => {
					if (live) startTransition(() => setNow(r));
				},
				() => {},
			),
		);
		return () => {
			live = false;
		};
	}, [now]);
	return now;
}
