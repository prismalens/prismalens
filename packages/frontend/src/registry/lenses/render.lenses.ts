// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const renderFidelity = define.lens({
	id: "render.fidelity",
	group: "engineering",
	said: {
		date: "2026-11-12",
		quote:
			"Why do all our texts and icons look jagged and not production grade?",
		where: "operator, organizer session, 2026-11-12 15:40Z",
	},
	conditions: ["render.fidelity"],
	rubric:
		"Look at DPR-2 shots at 1600 px and at phone width: text, icons and borders are crisp and look production grade. A 1x shot proves nothing.",
	status: "active",
});
