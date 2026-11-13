// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Eye, Link2, Rows2, X } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** One pane's tab in the thread's right panel. */
export interface PaneCtx {
	show: () => void;
	tile: () => void;
	close: () => void;
	link: string;
	facts: Facts<"shown" | "tileable">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		pane: PaneCtx;
	}
	interface ObjectStates {
		pane: "shown" | "tileable";
	}
	interface ActionObjects {
		"pane.show": "pane";
		"pane.tile": "pane";
		"pane.copyLink": "pane";
		"pane.close": "pane";
	}
}

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
