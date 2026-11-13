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
import { firstContentPending, onFirstContent } from "@/lib/first-paint";

/**
 * A component whose code loads on its first render, so a page's first paint ships only
 * what it shows (#1101 category 12, 500 KB on the slow link). The fallback holds its
 * place meanwhile; `entry-budget.json` holds each route's first-paint scripts.
 * `afterFirstContent` waits for the page's first content before it starts the load.
 */
export function lazyPart<P extends object>(
	load: () => Promise<ComponentType<P>>,
	fallback: ReactNode | ((props: P) => ReactNode) = null,
	opts: { afterFirstContent?: boolean } = {},
): ComponentType<P> & { preload: () => Promise<unknown> } {
	let pending: Promise<ComponentType<P>> | null = null;
	const once = () => {
		pending ??= load();
		return pending;
	};
	const Part = lazy(() => once().then((c) => ({ default: c })));
	const held = (props: P) =>
		typeof fallback === "function" ? fallback(props) : fallback;
	function Lazy(props: P) {
		return (
			<Suspense fallback={held(props)}>
				<Part {...props} />
			</Suspense>
		);
	}
	function AfterFirstContent(props: P) {
		return useAfterFirstContent() ? <Lazy {...props} /> : held(props);
	}
	return Object.assign(opts.afterFirstContent ? AfterFirstContent : Lazy, {
		preload: once,
	});
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
 * False until the page has painted its first content (`lib/first-paint`), then true from a
 * transition: parts the first frame does not show mount, and fetch their code, after it.
 */
export function useAfterFirstContent(): boolean {
	const [ready, setReady] = useState(() => !firstContentPending());
	useEffect(() => {
		if (ready) return;
		let live = true;
		onFirstContent(() => {
			if (live) startTransition(() => setReady(true));
		});
		return () => {
			live = false;
		};
	}, [ready]);
	return ready;
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
