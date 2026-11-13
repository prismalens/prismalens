// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
	type AppCommand,
	runAppCommand,
	useAppCommand,
} from "@/lib/app-commands";
import { EARLY_CHORD_MS, takeEarlyKeys } from "@/lib/early-keys";
import { PLACES } from "@/lib/places";
import {
	chordTarget,
	chordTargetByKey,
	matches,
	runActionKey,
	shortcuts,
} from "@/lib/shortcuts";

/** The `g` chords, from the one places list: where each second key goes. Rendered by the `?` sheet too. */
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

/** The app command an `app.*` action's keys run, when these keys are one. */
function appKey(e: KeyboardEvent): AppCommand | null {
	for (const s of shortcuts())
		if (s.id.startsWith("app.") && matches(e, s.id))
			return s.id.slice(4) as AppCommand;
	return null;
}

export const GO_SHORTCUTS = PLACES.flatMap((p) =>
	p.goKey ? [{ id: p.id, key: p.goKey, to: p.to, label: p.label }] : [],
);

/** An early key carries only its text; it reads as an unmodified key event. */
type KeyLike = Pick<
	KeyboardEvent,
	"key" | "code" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
>;
const keyLike = (key: string): KeyLike => ({
	key,
	code: "",
	shiftKey: key === "?",
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		!!el?.isContentEditable
	);
}

/**
 * The `app.*` actions' keys, run first and on capture so a focused terminal or
 * editor cannot swallow them; a plain key waits while the operator types.
 */
export function useAppKeys() {
	useEffect(() => {
		const onAppKey = (e: KeyboardEvent) => {
			const app = appKey(e);
			if (!app) return;
			const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
			if (plain && isTyping(e.target)) return;
			if (!runAppCommand(app)) return;
			e.preventDefault();
			e.stopPropagation();
		};
		return listenKeys(onAppKey, { capture: true });
	}, []);
}

/**
 * `g` then a place's key (`GO_SHORTCUTS`, from `places.ts`) moves between the front doors; `c` opens New
 * thread with Incident on; `?` opens the shortcut sheet. Mounted once in the authenticated
 * layout. A chord waits one second for its second key, then forgets the first.
 */
export function useGlobalShortcuts(onHelp: () => void, onNew: () => void) {
	const navigate = useNavigate();
	const pending = useRef<number | null>(null);
	useAppKeys();
	useAppCommand("help", onHelp);
	useAppCommand("newIncident", () => {
		if (!document.querySelector("[role=dialog], [role=alertdialog]")) onNew();
	});

	useEffect(() => {
		const goTo = (id: string | null) => {
			const go = GO_SHORTCUTS.find((s) => `go.${s.id}` === id);
			if (go) navigate({ to: go.to });
			return !!go;
		};
		/** True when the key did something, so the event's default is dropped. */
		const run = (e: KeyLike, at = Date.now(), early = false): boolean => {
			if (pending.current !== null) {
				window.clearTimeout(pending.current);
				pending.current = null;
				return goTo(chordTarget("G", e as KeyboardEvent));
			}
			if (e.key.toLowerCase() === "g" && !e.shiftKey) {
				// A buffered g counts its age against the window; one already past it arms nothing.
				const left = EARLY_CHORD_MS - (Date.now() - at);
				if (left <= 0) return false;
				pending.current = window.setTimeout(() => {
					pending.current = null;
				}, left);
			} else if (early) {
				// A key pressed before mount: an app key replays here; live ones run in onAppKey.
				const app = appKey(e as KeyboardEvent);
				return app ? runAppCommand(app) : false;
			}
			return false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (isTyping(e.target)) return;
			// A plain key or a remap with Shift; Ctrl, Alt and Cmd keys belong to other handlers.
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (run(e)) e.preventDefault();
		};
		// A chord finished before mount counts by its recorded gap; only a trailing g waits live.
		let g: number | null = null;
		for (const early of takeEarlyKeys()) {
			if (g !== null && early.t - g <= EARLY_CHORD_MS) {
				g = null;
				goTo(chordTargetByKey("G", early.k));
				continue;
			}
			g = early.k === "g" ? early.t : null;
			if (g === null) run(keyLike(early.k), early.t, true);
		}
		if (g !== null) run(keyLike("g"), g);
		// Action keys run on the focused surface, else on the open thread's page (lib/shortcuts).
		const onActionKey = (e: KeyboardEvent) => {
			if (runActionKey(e)) e.preventDefault();
		};
		const offKey = listenKeys(onKey);
		const offAction = listenKeys(onActionKey);
		return () => {
			offKey();
			offAction();
			if (pending.current !== null) window.clearTimeout(pending.current);
		};
	}, [navigate, onHelp, onNew]);
}
