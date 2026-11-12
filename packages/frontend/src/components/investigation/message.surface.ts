// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		message: "message";
	}
}

/** A transcript message: right-click, and the quiet response row's icons (`more`). */
export const messageSurface = defineSurface({
	id: "message",
	label: "Message actions",
	menus: {
		context: ["message.copy", "message.fork"],
		more: ["message.copy", "message.fork"],
	},
	states: { default: "message-menu", phone: "response-actions" },
	marks: [],
});
