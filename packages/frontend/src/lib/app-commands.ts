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
	| "paneDetails"
	| "paneChanges"
	| "paneFiles"
	| "paneBrowser"
	| "paneKind";

const handlers = new Map<AppCommand, () => void>();

/** Runs a command when its owner is mounted; false when nothing handles it now. */
export function runAppCommand(id: AppCommand): boolean {
	const run = handlers.get(id);
	run?.();
	return !!run;
}

/** Which commands can run now: the facts an `app.*` action's `when` reads. */
export const appFacts = (): { is: Partial<Record<AppCommand, boolean>> } => ({
	is: Object.fromEntries(Array.from(handlers.keys(), (k) => [k, true])),
});

/** Handles one app command while the calling component is mounted; the latest `run` wins. */
export function useAppCommand(id: AppCommand, run: () => void, enabled = true) {
	const latest = useRef(run);
	latest.current = run;
	useEffect(() => {
		if (!enabled) return;
		const call = () => latest.current();
		handlers.set(id, call);
		return () => {
			if (handlers.get(id) === call) handlers.delete(id);
		};
	}, [id, enabled]);
}
