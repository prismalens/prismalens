// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ChevronLeft,
	ChevronRight,
	Eye,
	Link2,
	Maximize2,
	Minimize2,
	PanelRightClose,
	Rows2,
	SquareX,
	X,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

type PaneState =
	| "shown"
	| "tileable"
	| "wide"
	| "widenable"
	| "others"
	| "first"
	| "last";

/** One pane's tab in the thread's right panel. */
export interface PaneCtx {
	show: () => void;
	tile: () => void;
	close: () => void;
	/** Closes this tab; the panel closes with its last one. */
	closeTab: () => void;
	closeOthers: () => void;
	/** Moves the tab one place left (-1) or right (1). */
	move: (by: -1 | 1) => void;
	/** Expands the panel over the whole main column, or back (#1101 category 21 item 5). */
	widen: () => void;
	link: string;
	facts: Facts<PaneState>;
}

/** The pane object: the context its actions run with and the states they test. */
export const paneObject = defineObject<PaneCtx, PaneState>("pane");

export const paneShow = defineAction({
	id: "pane.show",
	label: "Show",
	icon: Eye,
	when: (f) => !f.is?.shown,
	run: (c) => c.show(),
});

export const paneTile = defineAction({
	id: "pane.tile",
	label: "Tile below",
	icon: Rows2,
	when: (f) => !!f.is?.tileable,
	run: (c) => c.tile(),
});

export const paneWiden = defineAction({
	id: "pane.widen",
	label: (c) => (c.facts.is?.wide ? "Restore the panel" : "Expand the panel"),
	icon: (c: PaneCtx) => (c.facts.is?.wide ? Minimize2 : Maximize2),
	when: (f) => !!f.is?.widenable,
	run: (c) => c.widen(),
});

export const paneCopyLink = defineAction({
	id: "pane.copyLink",
	label: "Copy link",
	icon: Link2,
	run: (c) => void copyText(c.link),
});

export const paneMoveLeft = defineAction({
	id: "pane.moveLeft",
	label: "Move left",
	icon: ChevronLeft,
	when: (f) => !!f.is?.others && !f.is?.first,
	run: (c) => c.move(-1),
});

export const paneMoveRight = defineAction({
	id: "pane.moveRight",
	label: "Move right",
	icon: ChevronRight,
	when: (f) => !!f.is?.others && !f.is?.last,
	run: (c) => c.move(1),
});

export const paneCloseTab = defineAction({
	id: "pane.closeTab",
	label: "Close",
	icon: X,
	run: (c) => c.closeTab(),
});

export const paneCloseOthers = defineAction({
	id: "pane.closeOthers",
	label: "Close others",
	icon: SquareX,
	when: (f) => !!f.is?.others,
	run: (c) => c.closeOthers(),
});

export const paneClose = defineAction({
	id: "pane.close",
	label: "Close the panel",
	icon: PanelRightClose,
	run: (c) => c.close(),
});
