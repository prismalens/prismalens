// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ComponentType,
	lazy,
	type ReactNode,
	Suspense,
	startTransition,
	useEffect,
	useState,
} from "react";

/**
 * A component whose code loads on its first render, so a page's first paint ships only
 * what it shows (#1101 category 12, 500 KB on the slow link). The fallback holds its
 * place meanwhile; `entry-budget.json` holds each route's first-paint scripts.
 */
export function lazyPart<P extends object>(
	load: () => Promise<ComponentType<P>>,
	fallback: ReactNode = null,
): ComponentType<P> & { preload: () => Promise<unknown> } {
	let pending: Promise<ComponentType<P>> | null = null;
	const once = () => {
		pending ??= load();
		return pending;
	};
	const Part = lazy(() => once().then((c) => ({ default: c })));
	function Lazy(props: P) {
		return (
			<Suspense fallback={fallback}>
				<Part {...props} />
			</Suspense>
		);
	}
	return Object.assign(Lazy, { preload: once });
}

/** Runs `fn` once the page is idle; returns a cancel for an effect's cleanup. */
export function whenIdle(fn: () => void): () => void {
	const w = globalThis as typeof globalThis & {
		requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
		cancelIdleCallback?: (id: number) => void;
	};
	if (w.requestIdleCallback) {
		const id = w.requestIdleCallback(fn, { timeout: 8_000 });
		return () => w.cancelIdleCallback?.(id);
	}
	const t = setTimeout(fn, 3_000);
	return () => clearTimeout(t);
}

/** True from the first time `open` is true: a lazy dialog mounts then and stays for its close. */
export function useOpenedOnce(open: boolean): boolean {
	const [opened, setOpened] = useState(open);
	if (open && !opened) setOpened(true);
	return opened || open;
}

/**
 * False until `shown` has rendered once, then true from a transition. A part gated on it renders in
 * React's yielding slices after the page paints, not inside its first task (#1101 category 12).
 * Gate only parts whose box does not move the page: an overlay, a panel's contents.
 */
export function useAfterFirstPaint(shown = true): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		if (shown) startTransition(() => setReady(true));
	}, [shown]);
	return ready;
}
