// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"tool.row": "tool";
	}
}

/** A tool call's row: its opened body shows Copy and Open as buttons too. */
export const toolRow = defineSurface({
	id: "tool.row",
	label: "Tool actions",
	menus: {
		context: [
			"tool.toggle",
			"-",
			"tool.copyCommand",
			"tool.copyOutput",
			"tool.openFile",
		],
	},
	states: { default: "pl-row", phone: "pl-row" },
	marks: ["status"],
});
