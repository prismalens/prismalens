// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const integrationsCost = define.condition({
	id: "integrations.cost",
	group: "product",
	said: {
		date: "2026-11-10",
		quote:
			"each integration point that we add is more technical debt that we have to maintain",
		where: "operator, organizer session, 2026-11-10 09:12Z",
	},
	appliesTo: { walks: [], categories: [] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{ state: "adding or removing an integration touches no core file" },
	],
	verdict: "reviewed",
	ci: { debt: "climb" },
	status: "parked",
});
