// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export { GO_SHORTCUTS } from "@/lib/places";

type KeyHandler = (e: KeyboardEvent) => void;
const lists = new WeakMap<EventTarget, Map<boolean, Set<KeyHandler>>>();

/**
 * The one place keys are listened for (L6): a handler joins its target's list for
 * its phase, and one real listener per target and phase calls the list in order.
 * Returns the unsubscribe, so an effect can `return listenKeys(onKey)`.
 */
export function listenKeys(
	handler: KeyHandler,
	opts: { target?: EventTarget; capture?: boolean } = {},
): () => void {
	const target = opts.target ?? window;
	const capture = !!opts.capture;
	const phases = lists.get(target) ?? new Map<boolean, Set<KeyHandler>>();
	lists.set(target, phases);
	let set = phases.get(capture);
	if (!set) {
		const handlers = new Set<KeyHandler>();
		const fire = (e: Event) => {
			for (const h of Array.from(handlers)) h(e as KeyboardEvent);
		};
		(handlers as Set<KeyHandler> & { fire?: (e: Event) => void }).fire = fire;
		set = handlers;
		phases.set(capture, set);
		target.addEventListener("keydown", fire, capture);
	}
	const own = set;
	own.add(handler);
	return () => {
		own.delete(handler);
		if (own.size) return;
		const fire = (own as Set<KeyHandler> & { fire?: (e: Event) => void }).fire;
		if (fire) target.removeEventListener("keydown", fire, capture);
		phases.delete(capture);
	};
}
