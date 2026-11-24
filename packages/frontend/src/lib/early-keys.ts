// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The prerendered shell shows the page before React runs, so a shortcut pressed then
 * reached no listener (#1020). This pre-paint script keeps those keys, with when and where
 * they were pressed, until the shortcuts mount; typing in a field, or in an open list or menu
 * whose typeahead owns plain letters, is left. A modified key
 * (Ctrl K) keeps its modifiers, since the key listeners mount after the first content.
 */
export const EARLY_KEYS_SCRIPT = `(function(){try{window.__plEarlyKeys=[];
window.addEventListener('keydown',function(e){var k=window.__plEarlyKeys;if(!k||k.length>=64)return;
var t=e.target,n=t&&t.tagName,mod=e.metaKey||e.ctrlKey||e.altKey;if(!mod&&(n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||(t&&t.isContentEditable)||(t&&t.closest&&t.closest('[role=listbox],[role=menu]'))))return;
var r={k:e.key,t:Date.now(),p:location.pathname};if(mod){r.c=e.ctrlKey;r.m=e.metaKey;r.a=e.altKey;r.s=e.shiftKey;r.d=e.code;}k.push(r);},true);}catch(_){}})();`;

/** Older keys are dropped; slow first loads still keep a key pressed as the page appeared. */
export const EARLY_KEY_MAX_AGE_MS = 15_000;
/** A modified key (Alt+2, Ctrl K) is never typed by accident: it waits out a slow link's mount (#1101 bar 21.1). */
export const EARLY_MOD_KEY_MAX_AGE_MS = 10_000;

export interface EarlyKey {
	k: string;
	t: number;
	p: string;
	/** Ctrl, Cmd, Alt and Shift, recorded only on a modified key. */
	c?: boolean;
	m?: boolean;
	a?: boolean;
	s?: boolean;
	/** The physical key, on a modified key: Option+O on a Mac types `ø` (#1101). */
	d?: string;
}

type EarlyKeysWindow = Window & { __plEarlyKeys?: EarlyKey[] | null };

const editable = (el: Element | null) => {
	const h = el as HTMLElement | null;
	const tag = h?.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		!!h?.isContentEditable
	);
};

/**
 * The keys still worth replaying, oldest first; keeping stops here, so each is taken once.
 * None when a dialog is open now; with a field focused, or a list or menu open, only modified keys,
 * as live keys behave: the open list's typeahead owns a plain letter pressed before the mount (#1154).
 */
export function takeEarlyKeys(now = Date.now()): EarlyKey[] {
	if (typeof window === "undefined") return [];
	const w = window as EarlyKeysWindow;
	const keys = w.__plEarlyKeys ?? [];
	w.__plEarlyKeys = null;
	if (document.querySelector("[role=dialog], [role=alertdialog]")) return [];
	const typing =
		editable(document.activeElement) ||
		!!document.querySelector("[role=listbox], [role=menu]");
	return keys.filter(
		(e) =>
			now - e.t <=
				(e.c || e.m || e.a ? EARLY_MOD_KEY_MAX_AGE_MS : EARLY_KEY_MAX_AGE_MS) &&
			e.p === window.location.pathname &&
			(!typing || !!(e.c || e.m || e.a)),
	);
}
