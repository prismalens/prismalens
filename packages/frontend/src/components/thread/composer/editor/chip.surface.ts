// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"attachment.chip": "chip";
	}
}

export const attachmentChip = defineSurface({
	id: "attachment.chip",
	label: "Attachment actions",
	menus: {
		context: ["chip.expand", "chip.open", "-", "chip.remove"],
		// The design matrix draws it; the chip itself shows only its icons.
		more: ["chip.expand", "chip.open", "-", "chip.remove"],
	},
	states: {
		default: "composer-chips",
		phone: "composer-chips",
		folded: "composer-paste-fold",
	},
	marks: [],
});
