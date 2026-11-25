// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BellRing,
	CircleHelp,
	FileCode2,
	FolderTree,
	Globe,
	Layers,
	Maximize2,
	MessagesSquare,
	PanelLeft,
	PanelRight,
	Rows3,
	Search,
	Siren,
	SquarePen,
	SquareTerminal,
	TextSearch,
	UnfoldVertical,
} from "lucide-react";
import { defineObject, type Facts } from "@/components/kit/actions";
import { type AppCommand, runAppCommand } from "@/lib/app-commands";
import { define } from "@/registry/define";

/** The app itself: its commands run where their owner is mounted (lib/app-commands). */
export interface AppCtx {
	facts: Facts<AppState>;
}

/** What a mounted command adds to the facts: why Send a test alert cannot run now. */
export type AppState = AppCommand | "noProject" | "gitless" | "sending";

/** The app object: its actions are the app-wide keys. */
export const appObject = defineObject<AppCtx, AppState>("app");

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

/** Message text across every thread: the palette's Messages tab, from anywhere (#1101 19.4). */
export const appFindMessages = define.action({
	id: "app.findMessages",
	label: "Find in every thread",
	icon: MessagesSquare,
	keys: { combo: "Mod+Shift+F", label: "Find in every thread", group: "App" },
	when: (f) => !!f.is?.findMessages,
	run: () => runAppCommand("findMessages"),
});

/** Focus, Standard, Full: the saved level of what a thread shows folded (#1101 cat 12). */
export const appTranscriptView = define.action({
	id: "app.transcriptView",
	label: "Switch the thread view",
	icon: Rows3,
	keys: {
		combo: "Alt+V",
		label: "Switch the thread view: Focus, Standard, Full",
		group: "Thread",
	},
	when: (f) => !!f.is?.transcriptView,
	run: () => runAppCommand("transcriptView"),
});

/** Opens every fold in this thread until you leave it; nothing is saved. */
export const appExpandAll = define.action({
	id: "app.expandAll",
	label: "Expand everything in this thread",
	icon: UnfoldVertical,
	keys: {
		combo: "Alt+E",
		label: "Expand everything in this thread",
		group: "Thread",
	},
	when: (f) => !!f.is?.expandAll,
	run: () => runAppCommand("expandAll"),
});

export const NO_PROJECT_WHY =
	"Add a project first. The test alert is sent for one of your projects.";
export const GITLESS_WHY =
	"This folder has no git, so there is no code history to investigate. Start git in it first.";

/** A high-severity sample alert for a project, through the webhook's own path; its page or Settings, Alert intake owns it. */
export const appSendTestAlert = define.action({
	id: "app.sendTestAlert",
	label: "Send a test alert",
	icon: BellRing,
	when: (f) => !!f.is?.sendTestAlert,
	disabled: (f) =>
		f.is?.noProject
			? NO_PROJECT_WHY
			: f.is?.gitless
				? GITLESS_WHY
				: !!f.is?.sending,
	run: () => runAppCommand("sendTestAlert"),
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

/** Widens the open right panel over the main column, or brings it back (#1101 category 21 item 5). */
export const appPanelExpand = define.action({
	id: "app.panelExpand",
	label: "Expand the panel",
	icon: Maximize2,
	keys: {
		combo: "Alt+M",
		label: "Expand or restore the right panel",
		group: "Thread",
	},
	when: (f) => !!f.is?.panelExpand,
	run: () => runAppCommand("panelExpand"),
});
