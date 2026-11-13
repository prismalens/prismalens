// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"pane.tab": "pane";
	}
}

export const paneTab = defineSurface({
	id: "pane.tab",
	label: "Pane actions",
	menus: {
		context: [
			"pane.show",
			"pane.tile",
			"-",
			"pane.copyLink",
			"-",
			"pane.close",
		],
	},
	states: { default: "pane-tabs", phone: "pane-tabs" },
	marks: [],
});
