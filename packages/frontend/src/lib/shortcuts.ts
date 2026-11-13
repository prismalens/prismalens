// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ActionId, SurfaceId } from "@/components/kit/actions";
import {
	activeSurface,
	runAction,
	setActionKeys,
	surfaceById,
} from "@/components/kit/registry";
import { EARLY_CHORD_MS } from "./early-keys";
import { PLACES } from "./places";

/**
 * The one keyboard registry (#1101 cat 18): the `?` sheet, Settings → Keyboard
 * shortcuts and the app's key handlers all read it. A binding is `Mod+K`
 * (Mod is Ctrl, or Cmd on a Mac), `Ctrl+\``, `[`, or a chord `G T`.
 */
export interface Shortcut {
	id: string;
	label: string;
	group: "App" | "Go to" | "Thread" | "Message box";
	keys: string;
	/** Keys that belong to a box or a list (Enter, Esc, J/K) stay as they are. */
	fixed?: boolean;
	/** A chord's first key is fixed; only its second key remaps. */
	chordPrefix?: string;
	/** The registry action these keys run on the focused surface (#1125). */
	action?: ActionId;
}

const GO: Shortcut[] = PLACES.flatMap((p) =>
	p.goKey
		? [
				{
					id: `go.${p.id}`,
					label: `Go to ${p.label}`,
					group: "Go to" as const,
					keys: `G ${p.goKey.toUpperCase()}`,
					chordPrefix: "G",
				},
			]
		: [],
);

export const SHORTCUTS: readonly Shortcut[] = [
	{ id: "search", label: "Search", group: "App", keys: "Mod+K" },
	{ id: "new-thread", label: "New thread", group: "App", keys: "Mod+Shift+O" },
	{ id: "new-incident", label: "Log incident", group: "App", keys: "C" },
	{ id: "fold-sidebar", label: "Fold the sidebar", group: "App", keys: "[" },
	{
		id: "terminal",
		label: "Show or hide the terminal",
		group: "App",
		keys: "Ctrl+`",
	},
	{ id: "help", label: "Keyboard sheet", group: "App", keys: "?" },
	...GO,
	{ id: "find", label: "Find in the thread", group: "Thread", keys: "Mod+F" },
	// Run on the focused thread row, else on the open thread; see runActionKey.
	{
		id: "message.copy",
		label: "Copy the focused message",
		group: "Thread",
		keys: "Y",
		action: "message.copy",
	},
	{
		id: "message.copyText",
		label: "Copy the focused message as text",
		group: "Thread",
		keys: "Shift+Y",
		action: "message.copyText",
	},
	{
		id: "block.copy",
		label: "Copy the focused block",
		group: "Thread",
		keys: "Alt+C",
		action: "block.copy",
	},
	{
		id: "block.addToComposer",
		label: "Add the focused block or selection to the message",
		group: "Thread",
		keys: "Alt+Q",
		action: "block.addToComposer",
	},
	{
		id: "block.run",
		label: "Send the focused command to the terminal",
		group: "Thread",
		keys: "Alt+T",
		action: "block.run",
	},
	{
		id: "thread.rename",
		label: "Rename the focused thread",
		group: "Thread",
		keys: "F2",
		action: "thread.rename",
	},
	{
		id: "thread.pin",
		label: "Pin or unpin the focused thread",
		group: "Thread",
		keys: "Alt+Shift+P",
		action: "thread.pin",
	},
	{
		id: "thread.archive",
		label: "Archive the focused thread",
		group: "Thread",
		keys: "Alt+Shift+A",
		action: "thread.archive",
	},
	{
		id: "thread.fork",
		label: "Fork the focused thread here",
		group: "Thread",
		keys: "F",
		action: "thread.fork",
	},
	{
		id: "thread.aside",
		label: "Ask a side question on the focused thread",
		group: "Thread",
		keys: "B",
		action: "thread.aside",
	},
	{
		id: "thread.worktree",
		label: "Fork the focused thread into a worktree",
		group: "Thread",
		keys: "W",
		action: "thread.worktree",
	},
	{
		id: "thread.link",
		label: "Copy the focused thread's link",
		group: "Thread",
		keys: "L",
		action: "thread.link",
	},
	{
		id: "thread.transcript",
		label: "Copy the focused thread's transcript",
		group: "Thread",
		keys: "T",
		action: "thread.transcript",
	},
	{
		id: "thread.settle",
		label: "Settle the focused thread",
		group: "Thread",
		keys: "S",
		action: "thread.settle",
	},
	{
		id: "list-move",
		label: "Next or previous item in the active list",
		group: "App",
		keys: "J K",
		fixed: true,
	},
	{
		id: "list-open",
		label: "Open the highlighted row",
		group: "App",
		keys: "Enter",
		fixed: true,
	},
	{ id: "back", label: "Go back", group: "App", keys: "Esc", fixed: true },
	{
		id: "send",
		label: "Send, at the agent's next pause",
		group: "Message box",
		keys: "Enter",
		fixed: true,
	},
	{
		id: "send-now",
		label: "Send now, ending the agent's step",
		group: "Message box",
		keys: "Mod+Enter",
		fixed: true,
	},
	{
		id: "newline",
		label: "New line",
		group: "Message box",
		keys: "Shift+Enter",
		fixed: true,
	},
	{
		id: "stop",
		label: "Stop the agent while it works",
		group: "Message box",
		keys: "Esc",
		fixed: true,
	},
	{
		id: "next-level",
		label: "Next permission level",
		group: "Message box",
		keys: "Shift+Tab",
		fixed: true,
	},
	{
		id: "model-list",
		label: "Open the model list",
		group: "Message box",
		keys: "Alt+P",
		fixed: true,
	},
	{
		id: "undo",
		label: "Undo, chips included",
		group: "Message box",
		keys: "Mod+Z",
		fixed: true,
	},
	{
		id: "redo",
		label: "Redo",
		group: "Message box",
		keys: "Mod+Y",
		fixed: true,
	},
	{
		id: "chip.expand",
		label: "Expand the selected folded paste",
		group: "Message box",
		keys: "Mod+Shift+E",
		action: "chip.expand",
	},
	{
		id: "paste-plain",
		label: "Paste as plain text",
		group: "Message box",
		keys: "Mod+Shift+V",
		fixed: true,
	},
];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

let remaps: Readonly<Record<string, string>> = {};
const listeners = new Set<() => void>();

/** The server's remaps, set once they load; a remap of a fixed or unknown id is ignored. */
export function setRemaps(next: Record<string, string>): void {
	const kept: Record<string, string> = {};
	for (const [id, keys] of Object.entries(next)) {
		const s = BY_ID.get(id);
		if (s && !s.fixed && parseKeys(keys)) kept[id] = keys;
	}
	remaps = kept;
	for (const l of Array.from(listeners)) l();
}

export function onRemaps(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export const currentRemaps = () => remaps;

/** The keys a shortcut takes now: its remap, else its default. */
export function bindingOf(id: string): string {
	return remaps[id] ?? BY_ID.get(id)?.keys ?? "";
}

interface Combo {
	mod: boolean;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	key: string;
}

const MODS = new Set(["mod", "ctrl", "shift", "alt"]);

/** One step of a binding; null when it names no key. */
function parseCombo(text: string): Combo | null {
	const parts = text.split("+").map((p) => p.trim());
	const key = parts.pop()?.toLowerCase();
	if (!key || MODS.has(key)) return null;
	const mods = new Set(parts.map((p) => p.toLowerCase()));
	if ([...parts].some((p) => !MODS.has(p.toLowerCase()))) return null;
	return {
		mod: mods.has("mod"),
		ctrl: mods.has("ctrl"),
		shift: mods.has("shift"),
		alt: mods.has("alt"),
		key,
	};
}

/** A binding as its steps: one combo, or two for a chord. */
export function parseKeys(text: string): Combo[] | null {
	const steps = text.trim().split(/\s+/);
	if (steps.length < 1 || steps.length > 2) return null;
	const combos = steps.map(parseCombo);
	return combos.every((c): c is Combo => c !== null) ? combos : null;
}

const CODE: Record<string, string> = {
	"`": "Backquote",
	"[": "BracketLeft",
	"]": "BracketRight",
	"/": "Slash",
	",": "Comma",
	".": "Period",
	";": "Semicolon",
};

/** The physical key a printable key sits on, so Ctrl+` works on layouts where `e.key` differs. */
function codeOf(key: string): string | undefined {
	if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
	if (/^[0-9]$/.test(key)) return `Digit${key}`;
	return CODE[key];
}

const isMac = () =>
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);

function comboMatches(e: KeyboardEvent, c: Combo): boolean {
	const ctrlWanted = c.ctrl || (c.mod && !isMac());
	const metaWanted = c.mod && isMac();
	if (e.ctrlKey !== ctrlWanted || e.metaKey !== metaWanted) return false;
	if (e.altKey !== c.alt) return false;
	const key = e.key.toLowerCase();
	// A shifted symbol (`?`, `{`) is its own key; a letter or a named key needs the Shift it names.
	const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
	if (!symbol && e.shiftKey !== c.shift) return false;
	if (key === c.key) return true;
	const named: Record<string, string> = { esc: "escape", space: " " };
	if (named[c.key] === key) return true;
	return codeOf(c.key) === e.code;
}

/** True when a single-step shortcut's current binding matches this key event. */
export function matches(e: KeyboardEvent, id: string): boolean {
	const steps = parseKeys(bindingOf(id));
	return !!steps && steps.length === 1 && comboMatches(e, steps[0] as Combo);
}

/** A chord's second key, for the `g` handler: the go shortcut whose binding ends with this key. */
export function chordTarget(prefix: string, e: KeyboardEvent): string | null {
	for (const s of SHORTCUTS) {
		if (s.chordPrefix !== prefix) continue;
		const steps = parseKeys(bindingOf(s.id));
		if (steps?.length === 2 && comboMatches(e, steps[1] as Combo)) return s.id;
	}
	return null;
}

/** The chord's second key as text, for the early-key buffer that only kept `e.key`. */
export function chordTargetByKey(prefix: string, key: string): string | null {
	const lower = key.toLowerCase();
	for (const s of SHORTCUTS) {
		if (s.chordPrefix !== prefix) continue;
		const steps = parseKeys(bindingOf(s.id));
		const second = steps?.[1];
		if (
			second &&
			!second.mod &&
			!second.ctrl &&
			!second.alt &&
			second.key === lower
		)
			return s.id;
	}
	return null;
}

/** A key event as a binding, for the remap field; null for a lone modifier. */
export function comboFromEvent(e: KeyboardEvent): string | null {
	if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
	const parts: string[] = [];
	// Mod is Cmd on a Mac and Ctrl elsewhere; a Mac's Ctrl stays Ctrl.
	if (isMac() ? e.metaKey : e.ctrlKey) parts.push("Mod");
	if (isMac() && e.ctrlKey) parts.push("Ctrl");
	if (e.altKey) parts.push("Alt");
	const key = e.key === " " ? "Space" : e.key === "Escape" ? "Esc" : e.key;
	const symbol = key.length === 1 && !/[a-z0-9]/i.test(key);
	if (e.shiftKey && !symbol) parts.push("Shift");
	parts.push(key.length === 1 ? key.toUpperCase() : key);
	return parts.join("+");
}

/** The shortcut that already takes these keys, other than `except`. */
export function takenBy(keys: string, except: string): Shortcut | null {
	const norm = normalise(keys);
	for (const s of SHORTCUTS)
		if (s.id !== except && normalise(bindingOf(s.id)) === norm) return s;
	return null;
}

const normalise = (keys: string) =>
	keys
		.trim()
		.split(/\s+/)
		.map((step) =>
			step
				.split("+")
				.map((p) => p.trim().toLowerCase())
				.sort()
				.join("+"),
		)
		.join(" ");

/** A binding for display: one key cap per key, Mod shown as Cmd on a Mac. */
export function keyCaps(keys: string): string[][] {
	return keys
		.trim()
		.split(/\s+/)
		.map((step) =>
			step
				.split("+")
				.map((p) => (p === "Mod" ? (isMac() ? "Cmd" : "Ctrl") : p)),
		);
}

/** Every listed shortcut with its current keys, for the sheet and the Settings page. */
export function shortcutRows(): (Shortcut & {
	current: string;
	changed: boolean;
})[] {
	return SHORTCUTS.map((s) => ({
		...s,
		current: bindingOf(s.id),
		changed: remaps[s.id] !== undefined,
	}));
}

/** The shortcut bound to an action, from `list` (the registry by default). */
export function shortcutForAction(
	action: string,
	list: readonly Shortcut[] = SHORTCUTS,
): Shortcut | undefined {
	return list.find((s) => s.action === action);
}

// Menu rows show the keys their action is bound to, remaps included.
setActionKeys((id) => {
	const s = shortcutForAction(id);
	return s ? bindingOf(s.id) : undefined;
});

/** The open thread's surface: action keys run on it when no surface has focus. */
let page: { id: SurfaceId; ctx: () => unknown } | null = null;
export function setPageSurface(next: typeof page): void {
	page = next;
}

const typing = (el: Element | null) =>
	!!el &&
	(el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT" ||
		(el as HTMLElement).isContentEditable);

let lastG = 0;

/**
 * Runs the action bound to these keys on the focused surface, else on the open
 * thread's page, when that surface's menus offer it; true when one ran.
 */
export function runActionKey(
	e: KeyboardEvent,
	list: readonly Shortcut[] = SHORTCUTS,
): boolean {
	if (e.defaultPrevented) return false;
	const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
	if (plain) {
		// A plain key never fires while typing, over a dialog or menu, or as a `g` chord's second key.
		if (e.key === "g") lastG = Date.now();
		const chord = e.key !== "g" && Date.now() - lastG < EARLY_CHORD_MS;
		if (chord) lastG = 0;
		if (e.key === "g" || chord || typing(document.activeElement)) return false;
		if (
			document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")
		)
			return false;
	}
	const active = activeSurface();
	const focused =
		!!active &&
		document.activeElement?.closest(`[data-surface='${active.id}']`) != null;
	const target = focused ? active : page;
	if (!target) return false;
	const menus = surfaceById(target.id)?.menus;
	const offered = new Set<string>([
		...(menus?.context ?? []),
		...(menus?.more ?? []),
	]);
	for (const s of list) {
		if (!s.action || !offered.has(s.action) || !matches(e, s.id)) continue;
		if (runAction(s.action, target.ctx() as never)) return true;
	}
	return false;
}
