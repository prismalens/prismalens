// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PanelTopOpen, X } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";

/** A chip in the composer's text: a file, paste, quote, reference or command. */
export interface ChipCtx {
	open: () => void;
	remove: () => void;
	facts: Facts;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		chip: ChipCtx;
	}
	interface ActionObjects {
		"chip.open": "chip";
		"chip.remove": "chip";
	}
}

export const chipOpen = defineAction({
	id: "chip.open",
	label: "Show details",
	icon: PanelTopOpen,
	run: (c) => c.open(),
});

export const chipRemove = defineAction({
	id: "chip.remove",
	label: "Remove",
	icon: X,
	destructive: true,
	run: (c) => c.remove(),
});
