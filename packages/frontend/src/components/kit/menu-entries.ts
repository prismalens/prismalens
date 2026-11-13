// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";

/** A menu row is an icon and a verb, nothing under it (pattern sheet §0.3). */
export type MenuEntry =
	| {
			id: string;
			label: string;
			icon?: LucideIcon;
			onSelect: () => void;
			danger?: boolean;
			disabled?: boolean;
			/** Why a disabled entry can't run now, shown at the row's end (#1101 bar 20.3). */
			why?: string;
			/** A choice that is on: a tick at the row's end. */
			checked?: boolean;
			/** The entry's binding from the shortcut registry (`bindingOf(id)`), shown at the row's end. */
			keys?: string;
	  }
	| { id: string; separator: true };

/**
 * One order for every menu: destructive entries last behind one separator,
 * and no leading, trailing or doubled separators.
 */
export function orderEntries(entries: readonly MenuEntry[]): MenuEntry[] {
	const danger = (e: MenuEntry) => !("separator" in e) && !!e.danger;
	const clean = (list: readonly MenuEntry[]) => {
		const out: MenuEntry[] = [];
		for (const e of list) {
			const last = out.at(-1);
			if ("separator" in e && (!last || "separator" in last)) continue;
			out.push(e);
		}
		while (out.length && "separator" in (out.at(-1) as MenuEntry)) out.pop();
		return out;
	};
	const nonDanger = clean(entries.filter((e) => !danger(e)));
	const dangerEntries = entries.filter(danger);
	if (!dangerEntries.length) return nonDanger;
	if (!nonDanger.length) return dangerEntries;
	return [
		...nonDanger,
		{ id: "sep-danger", separator: true },
		...dangerEntries,
	];
}

/** The entries a palette lists for an object: its menu rows without separators. */
export function commandEntries(entries: readonly MenuEntry[]) {
	return orderEntries(entries).filter(
		(e): e is Exclude<MenuEntry, { separator: true }> => !("separator" in e),
	);
}

export const isMac = () =>
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);

/** A binding as the user's keyboard names it: Mod is Cmd on a Mac, Ctrl elsewhere. */
export const keyText = (keys: string) =>
	keys.replaceAll("Mod", isMac() ? "Cmd" : "Ctrl");

/** Shift+F10 or the Menu key, the keyboard's right-click. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
	e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/** True when the user has text selected inside `el`: the browser's Copy menu wins there. */
export function selectedWithin(el: Element): boolean {
	const sel = typeof window === "undefined" ? null : window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
	return sel.getRangeAt(0).intersectsNode(el);
}
