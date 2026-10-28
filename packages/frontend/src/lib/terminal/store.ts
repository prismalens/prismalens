// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	runnableCommand,
	type TerminalClientFrame,
} from "@prismalens/contracts";
import { useSyncExternalStore } from "react";

/**
 * The terminal's tabs and staged commands, outside React so "Run in terminal"
 * anywhere in the app can reach the panel the layout mounts (#931, #973).
 * A staged command sits in the panel's own line until the user presses Enter;
 * nothing reaches the shell before that.
 */
export interface TerminalTab {
	id: number;
	title: string;
	draft: string;
	/** Undefined while the shell runs; its exit code once it ended. */
	exitCode?: number | null;
}

interface State {
	hosts: number;
	tabs: TerminalTab[];
	active: number | null;
}

type Sender = (frame: TerminalClientFrame) => void;

export function createTerminalStore() {
	let state: State = { hosts: 0, tabs: [], active: null };
	let nextId = 1;
	const listeners = new Set<() => void>();
	const openListeners = new Set<() => void>();
	const senders = new Map<number, Sender>();

	const set = (next: Partial<State>) => {
		state = { ...state, ...next };
		listeners.forEach((l) => {
			l();
		});
	};
	const patch = (id: number, change: Partial<TerminalTab>) =>
		set({
			tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...change } : t)),
		});

	const store = {
		get: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** The layout's bottom slot mounts the panel; until then Run in terminal stays hidden. */
		registerHost() {
			set({ hosts: state.hosts + 1 });
			return () => set({ hosts: Math.max(0, state.hosts - 1) });
		},
		onOpenRequest(listener: () => void) {
			openListeners.add(listener);
			return () => openListeners.delete(listener);
		},
		newTab(): number {
			const id = nextId++;
			const n = state.tabs.length + 1;
			set({
				tabs: [
					...state.tabs,
					{ id, title: n === 1 ? "Terminal" : `Terminal ${n}`, draft: "" },
				],
				active: id,
			});
			return id;
		},
		closeTab(id: number) {
			senders.delete(id);
			const tabs = state.tabs.filter((t) => t.id !== id);
			set({
				tabs,
				active: state.active === id ? (tabs.at(-1)?.id ?? null) : state.active,
			});
		},
		activate(id: number) {
			set({ active: id });
		},
		markExited(id: number, code: number | null) {
			patch(id, { exitCode: code });
		},
		setDraft(id: number, draft: string) {
			patch(id, { draft });
		},
		/** Run in terminal: the command waits in the active shell's line. */
		stage(command: string) {
			if (!runnableCommand(command)) return;
			const current = state.tabs.find((t) => t.id === state.active);
			const id =
				current && current.exitCode === undefined ? current.id : store.newTab();
			set({ active: id });
			patch(id, { draft: command });
			openListeners.forEach((l) => {
				l();
			});
		},
		attachSender(id: number, send: Sender) {
			senders.set(id, send);
			return () => {
				if (senders.get(id) === send) senders.delete(id);
			};
		},
		send(id: number, frame: TerminalClientFrame) {
			senders.get(id)?.(frame);
		},
		/** Enter in the staged line: the only path a staged command takes to the shell. */
		runDraft(id: number) {
			const tab = state.tabs.find((t) => t.id === id);
			if (!tab || !runnableCommand(tab.draft)) return;
			const send = senders.get(id);
			if (!send) return;
			send({ t: "run", d: tab.draft });
			patch(id, { draft: "" });
		},
	};
	return store;
}

export type TerminalStore = ReturnType<typeof createTerminalStore>;

export const terminalStore = createTerminalStore();

export function useTerminalState<T>(select: (state: State) => T): T {
	return useSyncExternalStore(
		terminalStore.subscribe,
		() => select(terminalStore.get()),
		() => select(terminalStore.get()),
	);
}
