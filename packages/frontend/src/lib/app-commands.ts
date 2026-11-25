// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef } from "react";

/** The app-wide commands the `app.*` actions run; each is handled by the component that owns it. */
export type AppCommand =
	| "search"
	| "newThread"
	| "newIncident"
	| "foldSidebar"
	| "terminal"
	| "help"
	| "find"
	| "findMessages"
	| "paneDetails"
	| "paneChanges"
	| "paneFiles"
	| "paneBrowser"
	| "paneKind"
	| "panelExpand"
	| "transcriptView"
	| "expandAll"
	| "sendTestAlert";

const handlers = new Map<AppCommand, () => void>();
/** What blocks a mounted command right now, read when its action is listed. */
const blockers = new Map<AppCommand, () => Record<string, boolean>>();

/** Commands a key may ask for before the page can run them: a pane key pressed while the thread loads. */
const HELD: ReadonlySet<AppCommand> = new Set<AppCommand>([
	"paneDetails",
	"paneChanges",
	"paneFiles",
	"paneBrowser",
	"paneKind",
]);
const HOLD_MS = 10_000;
let held: { id: AppCommand; at: number; path: string } | null = null;
const here = () => (typeof location === "undefined" ? "" : location.pathname);

/** Runs a command when its owner is mounted; false when nothing handles it now. */
export function runAppCommand(id: AppCommand): boolean {
	const run = handlers.get(id);
	run?.();
	return !!run;
}

/**
 * A key's command: run now, or for a pane key, held until this page can open the pane,
 * so Alt+2 works from the first paint on a slow link (#1101 bar 21.1). True when taken.
 */
export function keyAppCommand(id: AppCommand): boolean {
	if (runAppCommand(id)) return true;
	if (!HELD.has(id)) return false;
	held = { id, at: Date.now(), path: here() };
	return true;
}

/**
 * Which commands can run now, and what blocks the ones that name it: the facts an `app.*`
 * action's `when` and `disabled` read.
 */
export const appFacts = (): { is: Record<string, boolean> } => ({
	is: {
		...Object.assign({}, ...Array.from(blockers.values(), (b) => b())),
		...Object.fromEntries(Array.from(handlers.keys(), (k) => [k, true])),
	},
});

/**
 * Handles one app command while the calling component is mounted; the latest `run` wins.
 * `blocked` names the facts that stop it for now, so the palette lists it as the page does.
 */
export function useAppCommand(
	id: AppCommand,
	run: () => void,
	enabled = true,
	blocked?: Record<string, boolean>,
) {
	const latest = useRef(run);
	latest.current = run;
	const facts = useRef(blocked);
	facts.current = blocked;
	useEffect(() => {
		if (!enabled) return;
		const call = () => latest.current();
		handlers.set(id, call);
		blockers.set(id, () => facts.current ?? {});
		if (held?.id === id) {
			const fresh = Date.now() - held.at < HOLD_MS && held.path === here();
			held = null;
			if (fresh) call();
		}
		return () => {
			if (handlers.get(id) === call) {
				handlers.delete(id);
				blockers.delete(id);
			}
		};
	}, [id, enabled]);
}
