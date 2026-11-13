// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** The composer's "edited on another device" line: one Choose, both copies in its menu. */
export const draftConflict = defineSurface({
	id: "draft.conflict",
	label: "Draft copies",
	menus: {
		more: ["draft.keepMine", "draft.useTheirs"],
		context: ["draft.keepMine", "draft.useTheirs"],
	},
	states: { default: "composer-conflict", phone: "composer-conflict" },
	marks: [],
});
