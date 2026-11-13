// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CircleHelp,
	PanelLeft,
	Search,
	Siren,
	SquarePen,
	SquareTerminal,
	TextSearch,
} from "lucide-react";
import { defineObject, type Facts } from "@/components/kit/actions";
import { type AppCommand, runAppCommand } from "@/lib/app-commands";
import { define } from "@/registry/define";

/** The app itself: its commands run where their owner is mounted (lib/app-commands). */
export interface AppCtx {
	facts: Facts<AppCommand>;
}

/** The app object: its actions are the app-wide keys. */
export const appObject = defineObject<AppCtx, AppCommand>("app");

export const appSearch = define.action({
	id: "app.search",
	label: "Search",
	icon: Search,
	keys: { combo: "Mod+K", label: "Search", group: "App" },
	when: (f) => !!f.is?.search,
	run: () => runAppCommand("search"),
});

export const appNewThread = define.action({
	id: "app.newThread",
	label: "New thread",
	icon: SquarePen,
	keys: { combo: "Mod+Shift+O", label: "New thread", group: "App" },
	when: (f) => !!f.is?.newThread,
	run: () => runAppCommand("newThread"),
});

export const appNewIncident = define.action({
	id: "app.newIncident",
	label: "Log incident",
	icon: Siren,
	keys: { combo: "C", label: "Log incident", group: "App" },
	when: (f) => !!f.is?.newIncident,
	run: () => runAppCommand("newIncident"),
});

export const appFoldSidebar = define.action({
	id: "app.foldSidebar",
	label: "Fold the sidebar",
	icon: PanelLeft,
	keys: { combo: "[", label: "Fold the sidebar", group: "App" },
	when: (f) => !!f.is?.foldSidebar,
	run: () => runAppCommand("foldSidebar"),
});

export const appTerminal = define.action({
	id: "app.terminal",
	label: "Show or hide the terminal",
	icon: SquareTerminal,
	keys: { combo: "Ctrl+`", label: "Show or hide the terminal", group: "App" },
	when: (f) => !!f.is?.terminal,
	run: () => runAppCommand("terminal"),
});

export const appHelp = define.action({
	id: "app.help",
	label: "Keyboard sheet",
	icon: CircleHelp,
	keys: { combo: "?", label: "Keyboard sheet", group: "App" },
	when: (f) => !!f.is?.help,
	run: () => runAppCommand("help"),
});

export const appFind = define.action({
	id: "app.find",
	label: "Find in the thread",
	icon: TextSearch,
	keys: { combo: "Mod+F", label: "Find in the thread", group: "Thread" },
	when: (f) => !!f.is?.find,
	run: () => runAppCommand("find"),
});
