// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** A Home card that needs you: its status's fix is the card's one button; right-click lists every fix. */
export const needsCard = defineSurface({
	id: "needs.card",
	label: "Fix actions",
	menus: {
		context: [
			"needs.answer",
			"needs.updateKey",
			"needs.addCredit",
			"needs.raiseCap",
			"needs.freeSpace",
			"needs.signIn",
			"needs.retryNow",
			"needs.resume",
			"-",
			"needs.open",
		],
	},
	states: { default: "home-needs-fixes", phone: "home-needs-fixes" },
	marks: ["status", "agent", "startedBy", "changeRequest", "branch"],
});
