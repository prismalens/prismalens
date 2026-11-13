// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** A service's card: ⋯ and right-click list the same rows (ListCard draws both). */
export const serviceRow = defineSurface({
	id: "service.row",
	label: "Service actions",
	menus: {
		more: ["service.open", "service.ask", "-", "service.link"],
	},
	states: { default: "app-services", phone: "app-services" },
	marks: ["health", "code", "alert"],
});
