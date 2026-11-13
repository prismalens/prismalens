// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The prerendered shell shows the page before React runs, so a shortcut pressed then
 * reached no listener (#1020). This pre-paint script keeps those keys, with when and where
 * they were pressed, until the shortcuts mount; typing in a field is left. A modified key
 * (Ctrl K) keeps its modifiers, since the key listeners mount after the first content.
 */
export const EARLY_KEYS_SCRIPT = `(function(){try{window.__plEarlyKeys=[];
window.addEventListener('keydown',function(e){var k=window.__plEarlyKeys;if(!k||k.length>=8)return;
var t=e.target,n=t&&t.tagName,mod=e.metaKey||e.ctrlKey||e.altKey;if(!mod&&(n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||(t&&t.isContentEditable)))return;
var r={k:e.key,t:Date.now(),p:location.pathname};if(mod){r.c=e.ctrlKey;r.m=e.metaKey;r.a=e.altKey;r.s=e.shiftKey;}k.push(r);},true);}catch(_){}})();`;

/** Older keys are dropped; slow first loads still keep a key pressed as the page appeared. */
export const EARLY_KEY_MAX_AGE_MS = 2000;
/** The live chord window: an early `g` counts only with a next key this soon after it. */
export const EARLY_CHORD_MS = 1000;

export interface EarlyKey {
	k: string;
	t: number;
	p: string;
	/** Ctrl, Cmd, Alt and Shift, recorded only on a modified key. */
	c?: boolean;
	m?: boolean;
	a?: boolean;
	s?: boolean;
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
 * None when a dialog is open now; with a field focused only modified keys, as live keys behave.
 */
export function takeEarlyKeys(now = Date.now()): EarlyKey[] {
	if (typeof window === "undefined") return [];
	const w = window as EarlyKeysWindow;
	const keys = w.__plEarlyKeys ?? [];
	w.__plEarlyKeys = null;
	if (document.querySelector("[role=dialog], [role=alertdialog]")) return [];
	const typing = editable(document.activeElement);
	return keys.filter(
		(e) =>
			now - e.t <= EARLY_KEY_MAX_AGE_MS &&
			e.p === window.location.pathname &&
			(!typing || !!(e.c || e.m || e.a)),
	);
}
