// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The app's keys over the registry's shortcuts. Apart from `listenKeys`, so a component that
// only listens never brings the registry onto a first paint (#1101 category 12).

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
	type AppCommand,
	keyAppCommand,
	useAppCommand,
} from "@/lib/app-commands";
import { takeEarlyKeys } from "@/lib/early-keys";
import { GO_SHORTCUTS } from "@/lib/places";
import {
	composeBox,
	goTarget,
	matches,
	routedToCompose,
	runActionKey,
	shortcuts,
	typeToCompose,
} from "@/lib/shortcuts";
import { listenKeys } from "./use-global-shortcuts";

/** The app command an `app.*` action's keys run, when these keys are one. */
function appKey(e: KeyboardEvent): AppCommand | null {
	for (const s of shortcuts())
		if (s.id.startsWith("app.") && matches(e, s.id))
			return s.id.slice(4) as AppCommand;
	return null;
}

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
			// First: a key meant for the message box reaches it and nothing else (lib/shortcuts).
			if (typeToCompose(e) || routedToCompose(e)) {
				e.stopPropagation();
				return;
			}
			const app = appKey(e);
			if (!app) return;
			const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
			if (plain && isTyping(e.target)) return;
			if (!keyAppCommand(app)) return;
			e.preventDefault();
			e.stopPropagation();
		};
		return listenKeys(onAppKey, { capture: true });
	}, []);
}

/**
 * `c` logs an incident only where one is passed: Operations, never the shell, whose
 * words carry no alert terms (#1101, the shell's words).
 */
export function useNewIncidentKey(onNew: (() => void) | undefined) {
	useAppCommand(
		"newIncident",
		() => {
			if (!document.querySelector("[role=dialog], [role=alertdialog]"))
				onNew?.();
		},
		!!onNew,
	);
}

/**
 * A place's go key (`GO_SHORTCUTS`, from `places.ts`, always with a modifier) moves between the
 * front doors; `c` opens New thread with Incident on; `?` opens the shortcut sheet. Mounted once
 * in the authenticated layout.
 */
export function useGlobalShortcuts(onHelp: () => void, onNew?: () => void) {
	const navigate = useNavigate();
	useAppKeys();
	useAppCommand("help", onHelp);
	useNewIncidentKey(onNew);

	useEffect(() => {
		/** True when these keys are a place's go key; it goes there. */
		const go = (e: KeyLike) => {
			const id = goTarget(e);
			const place = GO_SHORTCUTS.find((s) => s.id === id);
			if (place) navigate({ to: place.to });
			return !!place;
		};
		// On a page with a message box, plain keys pressed before mount were typing: none replays.
		const textPage =
			/^\/threads\//.test(window.location.pathname) || !!composeBox();
		for (const early of takeEarlyKeys()) {
			const mod = !!(early.c || early.m || early.a);
			if (textPage && !mod) continue;
			const e: KeyLike = mod
				? {
						key: early.k,
						code: early.d ?? "",
						ctrlKey: !!early.c,
						metaKey: !!early.m,
						altKey: !!early.a,
						shiftKey: !!early.s,
					}
				: keyLike(early.k);
			if (go(e)) continue;
			const app = appKey(e as KeyboardEvent);
			if (app) keyAppCommand(app);
		}
		// On capture, like the app keys, so a focused terminal or editor cannot swallow them.
		const onGoKey = (e: KeyboardEvent) => {
			if (routedToCompose(e) || !go(e)) return;
			e.preventDefault();
			e.stopPropagation();
		};
		// Action keys run on the focused surface, else on the open thread's page (lib/shortcuts).
		const onActionKey = (e: KeyboardEvent) => {
			if (runActionKey(e)) e.preventDefault();
		};
		const offGo = listenKeys(onGoKey, { capture: true });
		const offAction = listenKeys(onActionKey);
		return () => {
			offGo();
			offAction();
		};
	}, [navigate, onHelp, onNew]);
}
