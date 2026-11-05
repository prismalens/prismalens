// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The prerendered shell shows the page before React runs, so a shortcut pressed then
 * reached no listener (#1020). This pre-paint script keeps those keys, with when and where
 * they were pressed, until the shortcuts mount; typing in a field and modified keys are left.
 */
export const EARLY_KEYS_SCRIPT = `(function(){try{window.__plEarlyKeys=[];
window.addEventListener('keydown',function(e){var k=window.__plEarlyKeys;if(!k||k.length>=8)return;
var t=e.target,n=t&&t.tagName;if(e.metaKey||e.ctrlKey||e.altKey||n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||(t&&t.isContentEditable))return;
k.push({k:e.key,t:Date.now(),p:location.pathname});},true);}catch(_){}})();`;

/** Older keys are dropped; slow first loads still keep a key pressed as the page appeared. */
export const EARLY_KEY_MAX_AGE_MS = 2000;
/** The live chord window: an early `g` counts only with a next key this soon after it. */
export const EARLY_CHORD_MS = 1000;

export interface EarlyKey {
	k: string;
	t: number;
	p: string;
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
 * None when a field has focus or a dialog is open now, as a live key would be ignored.
 */
export function takeEarlyKeys(now = Date.now()): EarlyKey[] {
	if (typeof window === "undefined") return [];
	const w = window as EarlyKeysWindow;
	const keys = w.__plEarlyKeys ?? [];
	w.__plEarlyKeys = null;
	if (
		editable(document.activeElement) ||
		document.querySelector("[role=dialog], [role=alertdialog]")
	)
		return [];
	return keys.filter(
		(e) =>
			now - e.t <= EARLY_KEY_MAX_AGE_MS && e.p === window.location.pathname,
	);
}
