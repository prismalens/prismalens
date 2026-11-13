// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const renderFidelity = define.condition({
	id: "render.fidelity",
	group: "engineering",
	said: {
		date: "2026-11-12",
		quote:
			"Why do all our texts and icons look jagged and not production grade?",
		where: "operator, organizer session, 2026-11-12 15:40Z",
	},
	appliesTo: { walks: [], categories: [] },
	simulator: "unbuilt",
	profile: { dpr: 2, widths: [1600, 390] },
	measure: [
		{
			state:
				"text and icons are crisp in DPR-2 shots at 1600 px and at phone width",
		},
	],
	verdict: "reviewed",
	ci: { debt: "climb" },
	status: "parked",
});
