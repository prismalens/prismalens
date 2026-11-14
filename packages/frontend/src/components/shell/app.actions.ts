// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CircleHelp,
	FileCode2,
	FolderTree,
	Globe,
	Layers,
	PanelLeft,
	PanelRight,
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

/** The thread panel's panes by number, in the New tab page's order (#1101 category 21). */
export const appPaneDetails = define.action({
	id: "app.paneDetails",
	label: "Open Details",
	icon: PanelRight,
	keys: { combo: "Alt+1", label: "Open the Details pane", group: "Thread" },
	when: (f) => !!f.is?.paneDetails,
	run: () => runAppCommand("paneDetails"),
});

export const appPaneChanges = define.action({
	id: "app.paneChanges",
	label: "Open Changes",
	icon: FileCode2,
	keys: { combo: "Alt+2", label: "Open the Changes pane", group: "Thread" },
	when: (f) => !!f.is?.paneChanges,
	run: () => runAppCommand("paneChanges"),
});

export const appPaneFiles = define.action({
	id: "app.paneFiles",
	label: "Open Files",
	icon: FolderTree,
	keys: { combo: "Alt+3", label: "Open the Files pane", group: "Thread" },
	when: (f) => !!f.is?.paneFiles,
	run: () => runAppCommand("paneFiles"),
});

export const appPaneBrowser = define.action({
	id: "app.paneBrowser",
	label: "Open Browser",
	icon: Globe,
	keys: { combo: "Alt+4", label: "Open the Browser pane", group: "Thread" },
	when: (f) => !!f.is?.paneBrowser,
	run: () => runAppCommand("paneBrowser"),
});

export const appPaneKind = define.action({
	id: "app.paneKind",
	label: "Open the thread's project, incident or service",
	icon: Layers,
	keys: {
		combo: "Alt+5",
		label: "Open the project, incident or service pane",
		group: "Thread",
	},
	when: (f) => !!f.is?.paneKind,
	run: () => runAppCommand("paneKind"),
});
