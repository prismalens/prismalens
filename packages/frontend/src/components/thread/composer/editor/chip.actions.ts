// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, PanelTopOpen, UnfoldVertical, X } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A chip in the composer's text: a file, paste, quote, reference or command. */
export interface ChipCtx {
	open: () => void;
	remove: () => void;
	/** What the chip stands for in the sent message: a paste's text, a quote, a path or a link. */
	text: string;
	/** A folded paste back into the box as its text, in the chip's place. */
	expand?: () => void;
	facts: Facts<"folded" | "overLimit">;
}

/** The chip object: the context its actions run with and the states they test. */
export const chipObject = defineObject<ChipCtx, "folded" | "overLimit">("chip");

export const chipOpen = defineAction({
	id: "chip.open",
	label: "Show details",
	icon: PanelTopOpen,
	run: (c) => c.open(),
});

export const chipCopy = defineAction({
	id: "chip.copy",
	label: "Copy",
	icon: Copy,
	run: (c) => void copyText(c.text),
});

const OVER_LIMIT = "Over the box's limit";

/** One undo step: Ctrl+Z folds it back (#1101). */
export const chipExpand = defineAction({
	id: "chip.expand",
	keys: {
		combo: "Mod+Shift+E",
		label: "Expand the selected folded paste",
		group: "Message box",
	},
	label: "Expand",
	icon: UnfoldVertical,
	when: (f) => !!f.is?.folded,
	disabled: (f) => (f.is?.overLimit ? OVER_LIMIT : false),
	run: (c) => c.expand?.(),
});

export const chipRemove = defineAction({
	id: "chip.remove",
	label: "Remove",
	icon: X,
	destructive: true,
	run: (c) => c.remove(),
});
