// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type KeybindingPress,
	matchKeybindingPress,
	parseKeybinding,
} from "tinykeys";
import type {
	ActionId,
	ShortcutGroup,
	SurfaceId,
} from "@/components/kit/actions";
import { pageSurface } from "@/components/kit/active-surface";
import {
	activeSurface,
	allActions,
	runAction,
	setActionKeys,
	surfaceById,
} from "@/components/kit/registry";
import { composePage, holdComposeText } from "@/lib/compose-pending";
import { PLACES } from "./places";

/**
 * The keyboard (#1101 cat 18): an action's `keys` field is its shortcut; the `?`
 * sheet, Settings → Keyboard shortcuts and the key handlers read them here. A
 * binding is `Mod+K` (Mod is Ctrl, or Cmd on a Mac), `Ctrl+\`` or `[`.
 */
export interface Shortcut {
	id: string;
	label: string;
	group: ShortcutGroup;
	keys: string;
	/** Keys that belong to a box or a list (Enter, Esc, J/K) stay as they are. */
	fixed?: boolean;
	/** The registry action these keys run (#1125); a shortcut from an action shares its id. */
	action?: ActionId;
	/** Fires in a focused text field on a Mac too; see `typesInField`. */
	inField?: boolean;
}

const GO: Shortcut[] = PLACES.flatMap((p) =>
	p.keys
		? [
				{
					id: `go.${p.id}`,
					label: `Go to ${p.label}`,
					group: "Go to" as const,
					keys: p.keys,
				},
			]
		: [],
);

/**
 * Keys that belong to a box or a list (Enter, Esc, J/K): fixed, never remapped,
 * and handled by the box itself, so they are not actions.
 */
const FIXED: readonly Shortcut[] = [
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
		id: "paste-plain",
		label: "Paste as plain text",
		group: "Message box",
		keys: "Mod+Shift+V",
		fixed: true,
	},
];

const GROUPS: readonly ShortcutGroup[] = [
	"App",
	"Go to",
	"Thread",
	"Message box",
];

let built: readonly Shortcut[] | null = null;
let index: ReadonlyMap<string, Shortcut> | null = null;

/**
 * Every key, grouped for the sheet: each action's `keys` (its id is the
 * shortcut's), the places' `g` chords, and the fixed keys. Built on first use,
 * since the registry is still loading when this module first runs.
 */
export function shortcuts(): readonly Shortcut[] {
	if (built) return built;
	const fromActions = allActions().flatMap((a): Shortcut[] =>
		a.keys
			? [
					{
						id: a.id,
						label: a.keys.label,
						group: a.keys.group,
						keys: a.keys.combo,
						action: a.id,
						...(a.keys.inField ? { inField: true } : {}),
					},
				]
			: [],
	);
	const all = [...fromActions, ...GO, ...FIXED];
	built = GROUPS.flatMap((g) => all.filter((s) => s.group === g));
	return built;
}

const byId = (id: string) => {
	index ??= new Map(shortcuts().map((s) => [s.id, s]));
	return index.get(id);
};

let remaps: Readonly<Record<string, string>> = {};
const listeners = new Set<() => void>();

/** The server's remaps, set once they load; a remap of a fixed or unknown id is ignored. */
export function setRemaps(next: Record<string, string>): void {
	const kept: Record<string, string> = {};
	for (const [id, keys] of Object.entries(next)) {
		const s = byId(id);
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
	return remaps[id] ?? byId(id)?.keys ?? "";
}

const MODS: Record<string, () => string> = {
	mod: () => (isMac() ? "Meta" : "Control"),
	ctrl: () => "Control",
	shift: () => "Shift",
	alt: () => "Alt",
};
const NAMED: Record<string, string> = { esc: "Escape", space: "Space" };

/** One step of a binding as a tinykeys press string; null when it names no key. */
function pressOf(text: string): string | null {
	const parts = text.split("+").map((p) => p.trim().toLowerCase());
	const key = parts.pop();
	if (!key || MODS[key] || parts.some((p) => !MODS[p])) return null;
	const mods = parts.map((p) => MODS[p]?.() as string);
	// A shifted symbol (`?`, `{`) is its own key: Shift may be down or not.
	if (key.length === 1 && !/[a-z0-9]/.test(key) && !mods.includes("Shift"))
		mods.push("[Shift]");
	return [...mods, NAMED[key] ?? key].join("+");
}

/** A binding as its one tinykeys press; null for anything else. */
export function parseKeys(text: string): KeybindingPress[] | null {
	const steps = text.trim().split(/\s+/).map(pressOf);
	if (steps.length !== 1 || steps[0] === null) return null;
	return parseKeybinding(steps.join(" "));
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

/** The physical key a printable key sits on. */
function codeOf(key: string): string | undefined {
	if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
	if (/^[0-9]$/.test(key)) return `Digit${key}`;
	return CODE[key.toLowerCase()];
}

const isMac = () =>
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);

type KeyFields = Pick<
	KeyboardEvent,
	"key" | "code" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
>;

/** Modifier state from the event's flags, so replayed early keys and test events match too. */
const view = (e: KeyFields) =>
	({
		key: e.key,
		code: e.code,
		getModifierState: (m: string) =>
			({
				Shift: e.shiftKey,
				Control: e.ctrlKey,
				Meta: e.metaKey,
				Alt: e.altKey,
			})[m] ?? false,
	}) as unknown as KeyboardEvent;

/**
 * The typed character decides, so a remapped layout's keys fire by their letters. Only
 * when the key typed no ASCII character (a dead key, Option+V's `√`, Cyrillic) does the
 * physical key decide (#1101).
 */
function pressMatches(e: KeyFields, press: KeybindingPress): boolean {
	const v = view(e);
	if (matchKeybindingPress(v, press)) return true;
	const [req, opt, key] = press;
	const code = typeof key === "string" ? codeOf(key) : undefined;
	const typedNothing =
		e.key.length > 1 ? e.key === "Dead" : !/^[\x20-\x7e]$/.test(e.key);
	return !!code && typedNothing && matchKeybindingPress(v, [req, opt, code]);
}

/**
 * Letters always type (#1101): on a Mac, Option+key in a focused text field types its
 * character (ø, å, ≤), so it fires no shortcut there unless the entry is `inField`.
 */
const typesInField = (e: KeyFields) =>
	isMac() &&
	e.altKey &&
	!e.ctrlKey &&
	!e.metaKey &&
	typing(document.activeElement);

/** True when a single-step shortcut's current binding matches this key event. */
export function matches(e: KeyFields, id: string): boolean {
	const steps = parseKeys(bindingOf(id));
	if (steps?.length !== 1) return false;
	if (typesInField(e) && !byId(id)?.inField) return false;
	return pressMatches(e, steps[0] as KeybindingPress);
}

/** The place a go key takes these keys to, by its shortcut id `go.<place>`; else null. */
export function goTarget(e: KeyFields): string | null {
	for (const s of shortcuts())
		if (s.id.startsWith("go.") && matches(e, s.id)) return s.id.slice(3);
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
	for (const s of shortcuts())
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
	return shortcuts().map((s) => ({
		...s,
		current: bindingOf(s.id),
		changed: remaps[s.id] !== undefined,
	}));
}

/** The shortcut bound to an action, from `list` (the registry by default). */
export function shortcutForAction(
	action: string,
	list: readonly Shortcut[] = shortcuts(),
): Shortcut | undefined {
	return list.find((s) => s.action === action);
}

// Menu rows show the keys their action is bound to, remaps included.
setActionKeys((id) => {
	const s = shortcutForAction(id);
	return s ? bindingOf(s.id) : undefined;
});

export { setPageSurface } from "@/components/kit/active-surface";

const typing = (el: Element | null) =>
	!!el &&
	(el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT" ||
		(el as HTMLElement).isContentEditable);

/** The page's message box: its editor, else the plain field standing in until the editor loads. */
export const COMPOSE_TARGET = [
	".composer-editor",
	'[data-testid="composer-stand-in"]',
] as const;

const routed = new WeakSet<Event>();

/**
 * Type to compose (#1101): a printable key with no modifier, pressed where no field and no
 * focused row takes it, focuses the page's message box and types there. Single-key actions
 * run only on the row that has focus, never on the page behind a box someone could type in.
 */
export function typeToCompose(e: KeyboardEvent): boolean {
	if (e.defaultPrevented || e.isComposing) return false;
	if (e.metaKey || e.ctrlKey || e.altKey) return false;
	if (e.key.length !== 1 || e.key === " ") return false;
	const box = composeBox();
	if (!box) {
		// The box is still loading: the letter waits for it rather than being lost.
		if (!composeFree() || !composePage(window.location.pathname)) return false;
		holdComposeText(e.key);
		e.preventDefault();
		routed.add(e);
		return true;
	}
	focusAtEnd(box);
	routed.add(e);
	return true;
}

/** No field or row holds focus and no dialog or menu is open. */
function composeFree(): boolean {
	const at = document.activeElement;
	// A list row counts before its menu's code wraps it in a surface (#1193, bar 1.8).
	if (typing(at) || at?.closest("[data-surface], [data-list-row]"))
		return false;
	return !document.querySelector(
		"[role=dialog], [role=alertdialog], [role=menu]",
	);
}

/**
 * The page's visible message box when a key could be meant for it: no field and no row
 * has focus, and no dialog or menu is open; else null.
 */
export function composeBox(): HTMLElement | null {
	if (!composeFree()) return null;
	// The editor first: during its hand-off both show, and text put in the field goes twice.
	for (const sel of COMPOSE_TARGET) {
		const box = Array.from(document.querySelectorAll<HTMLElement>(sel)).find(
			(el) => el.offsetParent !== null,
		);
		if (box) return box;
	}
	return null;
}

function focusAtEnd(box: HTMLElement): void {
	box.focus();
	// The caret goes after the draft, so the key adds to it.
	if (box instanceof HTMLTextAreaElement)
		box.setSelectionRange(box.value.length, box.value.length);
	else {
		const range = document.createRange();
		range.selectNodeContents(box);
		range.collapse(false);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
	}
}

/** True when this key went to the message box; every other key handler leaves it alone. */
export const routedToCompose = (e: Event) => routed.has(e);

/**
 * Runs the action bound to these keys on the focused surface, else on the open
 * thread's page, when that surface's menus offer it; true when one ran.
 */
export function runActionKey(
	e: KeyboardEvent,
	list: readonly Shortcut[] = shortcuts(),
): boolean {
	if (e.defaultPrevented || routedToCompose(e)) return false;
	const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
	if (plain) {
		// A plain key never fires while typing, or over a dialog or menu.
		if (typing(document.activeElement)) return false;
		if (
			document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")
		)
			return false;
	}
	const active = activeSurface();
	const focused =
		!!active &&
		document.activeElement?.closest(`[data-surface='${active.id}']`) != null;
	const target = focused ? active : pageSurface();
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
