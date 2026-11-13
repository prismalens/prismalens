// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PanelTopOpen, UnfoldVertical, X } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";

/** A chip in the composer's text: a file, paste, quote, reference or command. */
export interface ChipCtx {
	open: () => void;
	remove: () => void;
	/** A folded paste back into the box as its text, in the chip's place. */
	expand?: () => void;
	facts: Facts<"folded" | "overLimit">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		chip: ChipCtx;
	}
	interface ObjectStates {
		chip: "folded" | "overLimit";
	}
	interface ActionObjects {
		"chip.open": "chip";
		"chip.expand": "chip";
		"chip.remove": "chip";
	}
}

export const chipOpen = defineAction({
	id: "chip.open",
	label: "Show details",
	icon: PanelTopOpen,
	run: (c) => c.open(),
});

const OVER_LIMIT = "Over the box's limit";

/** One undo step: Ctrl+Z folds it back (#1101). */
export const chipExpand = defineAction({
	id: "chip.expand",
	label: "Expand into the box",
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
