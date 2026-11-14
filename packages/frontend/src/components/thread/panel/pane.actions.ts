// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Eye, Link2, Maximize2, Minimize2, Rows2, X } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** One pane's tab in the thread's right panel. */
export interface PaneCtx {
	show: () => void;
	tile: () => void;
	close: () => void;
	/** Widens the panel to all but the page's minimum, or back. */
	widen: () => void;
	link: string;
	facts: Facts<"shown" | "tileable" | "wide" | "widenable">;
}

/** The pane object: the context its actions run with and the states they test. */
export const paneObject = defineObject<
	PaneCtx,
	"shown" | "tileable" | "wide" | "widenable"
>("pane");

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
	label: (c) => (c.facts.is?.wide ? "Narrow the panel" : "Widen the panel"),
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

export const paneClose = defineAction({
	id: "pane.close",
	label: "Close the panel",
	icon: X,
	run: (c) => c.close(),
});
