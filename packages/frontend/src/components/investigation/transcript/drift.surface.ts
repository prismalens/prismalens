// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** An unknown update's plain row: right-click and the menu keys copy what the agent sent. */
export const driftRow = defineSurface({
	id: "drift.row",
	label: "Update actions",
	menus: { context: ["drift.copy"] },
	states: { default: "pl-row", phone: "pl-row" },
	marks: ["drift"],
});
