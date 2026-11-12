// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"sample.row": "sample";
	}
}

/** Stop is listed first on purpose: the kit draws it last, behind a separator. */
export const sampleRow = defineSurface({
	id: "sample.row",
	label: "Tool actions",
	menus: {
		context: ["sample.stop", "sample.copy", "sample.find"],
		more: ["sample.stop", "sample.copy", "sample.find"],
	},
	states: { default: "menu-object", phone: "menu-object" },
	marks: [],
});
