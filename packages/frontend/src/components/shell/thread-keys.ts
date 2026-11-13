// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ActionId } from "@/components/kit/actions";
import {
	activeSurface,
	runAction,
	setActionKeys,
} from "@/components/kit/registry";
import type { ThreadCtx } from "./thread.actions";

/**
 * One key per thread action (#1101 bar 20.1): the row and header menus show
 * them, and they run on the focused sidebar row, else on the open thread.
 */
export const THREAD_KEYS: Partial<Record<ActionId, string>> = {
	"thread.rename": "F2",
	"thread.pin": "P",
	"thread.fork": "F",
	"thread.aside": "B",
	"thread.worktree": "W",
	"thread.link": "L",
	"thread.transcript": "T",
	"thread.settle": "S",
	"thread.archive": "E",
};

const BY_KEY = new Map(
	Object.entries(THREAD_KEYS).map(([id, k]) => [k as string, id as ActionId]),
);

let page: (() => ThreadCtx) | null = null;
/** The open thread's page registers its context; the last one wins. */
export function setPageThread(ctx: (() => ThreadCtx) | null) {
	page = ctx;
}

const typing = (el: Element | null) =>
	!!el &&
	(el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT" ||
		(el as HTMLElement).isContentEditable);

/** The thread a key acts on: the focused row's, else the open page's. */
function target(): ThreadCtx | null {
	const at = document.activeElement;
	const row = at?.closest('[data-surface="thread.row"]');
	const active = activeSurface();
	if (row && active?.id === "thread.row") return active.ctx() as ThreadCtx;
	return page?.() ?? null;
}

let lastG = 0;
/** Handles a keydown; true when a thread action ran. Exported for tests. */
export function onThreadKey(e: KeyboardEvent): boolean {
	if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
	// `g` then a letter is a go chord (use-global-shortcuts); leave its second key alone.
	if (e.key === "g") {
		lastG = Date.now();
		return false;
	}
	if (Date.now() - lastG < 1000) {
		lastG = 0;
		return false;
	}
	const id = BY_KEY.get(e.key.length === 1 ? e.key.toUpperCase() : e.key);
	if (!id || e.shiftKey || typing(document.activeElement)) return false;
	if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]"))
		return false;
	const ctx = target();
	if (!ctx || !runAction(id as "thread.pin", ctx)) return false;
	e.preventDefault();
	return true;
}

let installed = false;
/** Mounts the key listener once and tells the menus the keys. */
export function installThreadKeys() {
	setActionKeys((id) => THREAD_KEYS[id]);
	if (installed || typeof window === "undefined") return;
	installed = true;
	window.addEventListener("keydown", onThreadKey);
}
