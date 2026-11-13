// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** A transcript message: right-click, and the quiet response row's icons (`more`). */
export const messageSurface = defineSurface({
	id: "message",
	label: "Message actions",
	menus: {
		context: ["message.copy", "message.copyText", "message.fork"],
		more: ["message.copy", "message.copyText", "message.fork"],
	},
	states: { default: "message-menu", phone: "response-actions" },
	marks: [],
});

/** A message waiting for the agent's next pause, in the dock: Edit and Withdraw as icons (`more`). */
export const queuedSurface = defineSurface({
	id: "message.queued",
	object: "queued",
	label: "Queued message actions",
	menus: {
		context: ["queued.edit", "queued.withdraw"],
		more: ["queued.edit", "queued.withdraw"],
	},
	states: { default: "composer-queued", phone: "composer-queued" },
	marks: ["delivery"],
});
