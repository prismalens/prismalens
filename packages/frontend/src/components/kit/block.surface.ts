// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

const ROWS = ["block.copy", "block.run", "block.addToComposer"] as const;

/** Every special block (`*.blocks.ts`): right-click, Shift+F10 and its keys. */
export const blockSurface = defineSurface({
	id: "block",
	label: "Block actions",
	menus: { context: ROWS, more: ROWS },
	states: { default: "block-menu", phone: "block-menu" },
	marks: [],
});
