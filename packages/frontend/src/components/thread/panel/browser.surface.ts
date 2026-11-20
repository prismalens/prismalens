// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

const ROWS = [
	"browser.takeControl",
	"browser.handBack",
	"-",
	"browser.reload",
	"browser.copyUrl",
	"browser.openOutside",
	"-",
	"browser.close",
] as const;

/** A host browser tab: its strip tab, and its address bar and page (`HostBrowserPane`). */
export const browserTab = defineSurface({
	id: "browser.tab",
	label: "Tab actions",
	menus: { context: ROWS, more: ROWS },
	states: {
		default: "browser-tab-menu",
		phone: "browser-tab-menu",
		live: "browser",
	},
	marks: [],
});
