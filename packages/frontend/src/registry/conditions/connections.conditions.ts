// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const connectionsRefs = define.condition({
	id: "connections.refs",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"we forget to look at it from a different perspective or find a connections to some other feature or requirement",
		where: "operator, organizer session, 2026-11-11 08:46Z",
	},
	appliesTo: { walks: [], categories: [] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{ state: "no surface has zero inbound or outbound refs in the manifest" },
	],
	verdict: "reviewed",
	ci: { debt: "climb" },
	status: "parked",
});
