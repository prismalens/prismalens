// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

const ROWS = [
	"pane.show",
	"pane.tile",
	"pane.widen",
	"pane.moveLeft",
	"pane.moveRight",
	"-",
	"pane.copyLink",
	"-",
	"pane.closeTab",
	"pane.closeOthers",
	"pane.close",
] as const;

/** A pane's tab: right-click, Shift+F10, the Menu key and a long press (`more` is the gallery's drawing). */
export const paneTab = defineSurface({
	id: "pane.tab",
	label: "Pane actions",
	menus: { context: ROWS, more: ROWS },
	states: { default: "pane-tabs", phone: "pane-tabs", menu: "pane-tab-menu" },
	marks: [],
});
