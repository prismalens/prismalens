// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** The app as a whole: its app-wide keys, listed on the keyboard sheet and in Settings. */
export const appSurface = define.surface({
	id: "app",
	label: "App actions",
	menus: {
		more: [
			"app.search",
			"app.newThread",
			"app.newIncident",
			"app.foldSidebar",
			"app.terminal",
			"app.help",
			"app.find",
			"app.paneDetails",
			"app.paneChanges",
			"app.paneFiles",
			"app.paneBrowser",
			"app.paneKind",
		],
	},
	states: { default: "help", phone: "settings-shortcuts" },
	marks: [],
});
