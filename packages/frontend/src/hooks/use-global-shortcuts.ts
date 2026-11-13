// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAppCommand } from "@/lib/app-commands";
import { EARLY_CHORD_MS, takeEarlyKeys } from "@/lib/early-keys";
import { PLACES } from "@/lib/places";
import { chordTarget, chordTargetByKey, matches } from "@/lib/shortcuts";

/** The `g` chords, from the one places list: where each second key goes. Rendered by the `?` sheet too. */
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
 * `g` then a place's key (`GO_SHORTCUTS`, from `places.ts`) moves between the front doors; `c` opens New
 * thread with Incident on; `?` opens the shortcut sheet. Mounted once in the authenticated
 * layout. A chord waits one second for its second key, then forgets the first.
 */
export function useGlobalShortcuts(onHelp: () => void, onNew: () => void) {
	const navigate = useNavigate();
	const pending = useRef<number | null>(null);
	useAppCommand("help", onHelp);
	useAppCommand("newIncident", onNew);

	useEffect(() => {
		const goTo = (id: string | null) => {
			const go = GO_SHORTCUTS.find((s) => `go.${s.id}` === id);
			if (go) navigate({ to: go.to });
			return !!go;
		};
		/** True when the key did something, so the event's default is dropped. */
		const run = (e: KeyLike, at = Date.now()): boolean => {
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
			} else if (matches(e as KeyboardEvent, "app.help")) {
				onHelp();
				return true;
			} else if (matches(e as KeyboardEvent, "app.newIncident")) {
				if (document.querySelector("[role=dialog], [role=alertdialog]"))
					return false;
				onNew();
				return true;
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
			if (g === null) run(keyLike(early.k), early.t);
		}
		if (g !== null) run(keyLike("g"), g);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			if (pending.current !== null) window.clearTimeout(pending.current);
		};
	}, [navigate, onHelp, onNew]);
}
