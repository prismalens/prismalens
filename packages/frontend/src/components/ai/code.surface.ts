// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		code: "code";
	}
}

/** A code block in a response: right-click, and its copy icon (`more`). */
export const codeSurface = defineSurface({
	id: "code",
	label: "Code actions",
	menus: {
		context: ["code.copy"],
		more: ["code.copy"],
	},
	states: { default: "code-copy", phone: "code-copy" },
	marks: [],
});
