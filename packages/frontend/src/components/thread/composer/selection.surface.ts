// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** Selected transcript text: the floating bar (`more`) and right-click hold the same rows. */
export const selectionSurface = defineSurface({
	id: "selection",
	label: "Selection actions",
	menus: {
		context: [
			"selection.copy",
			"-",
			"selection.quote",
			"selection.askNew",
			"selection.aside",
		],
		more: ["selection.quote", "selection.askNew", "selection.aside"],
	},
	states: { default: "selection-menu", phone: "selection-menu" },
	marks: [],
});
