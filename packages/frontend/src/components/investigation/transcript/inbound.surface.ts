// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

export const inboundRow = defineSurface({
	id: "inbound.row",
	label: "Incoming message actions",
	// A failed row draws its `more` steps under it (#1101 category 10).
	menus: {
		context: ["inbound.sendAgain", "inbound.openPr"],
		more: ["inbound.sendAgain", "inbound.openPr"],
	},
	states: { default: "inbound-rows", phone: "inbound-rows" },
	marks: ["inbound", "status"],
});
