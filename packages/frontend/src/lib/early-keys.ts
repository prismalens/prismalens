// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The prerendered shell shows the page before React runs, so a shortcut pressed then
 * reached no listener (#1020). This pre-paint script keeps those keys until the
 * shortcuts mount and take them; typing into a field and modified keys are left alone.
 */
export const EARLY_KEYS_SCRIPT = `(function(){try{window.__plEarlyKeys=[];
window.addEventListener('keydown',function(e){var k=window.__plEarlyKeys;if(!k||k.length>=8)return;
var t=e.target,n=t&&t.tagName;if(e.metaKey||e.ctrlKey||e.altKey||n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||(t&&t.isContentEditable))return;
k.push(e.key);},true);}catch(_){}})();`;

type EarlyKeysWindow = Window & { __plEarlyKeys?: string[] | null };

/** The keys pressed so far, oldest first; keeping stops here, so each is taken once. */
export function takeEarlyKeys(): string[] {
	if (typeof window === "undefined") return [];
	const w = window as EarlyKeysWindow;
	const keys = w.__plEarlyKeys ?? [];
	w.__plEarlyKeys = null;
	return keys;
}
