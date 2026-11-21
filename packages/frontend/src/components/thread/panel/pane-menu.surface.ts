// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** The pane menu (`PaneMenu`): each tool by its app key, so the rows show their keys. Tiling is on a tab's menu and the New tab page. */
export const paneOpen = defineSurface({
	id: "pane.open",
	object: "app",
	label: "Open a pane",
	menus: {
		more: [
			"app.paneDetails",
			"app.paneChanges",
			"app.paneFiles",
			"app.paneBrowser",
			"app.terminal",
			"app.paneKind",
		],
	},
	states: { default: "pane-menu", phone: "pane-menu" },
	marks: [],
});
