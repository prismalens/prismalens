// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** One call the run's mode approved or blocked without asking, in the dock's decided list. */
export const decisionSurface = defineSurface({
	id: "decision",
	label: "Decision actions",
	menus: {
		context: ["decision.copy"],
		more: ["decision.copy"],
	},
	states: { default: "composer-decided", phone: "composer-decided" },
	marks: ["decided", "reach"],
});
