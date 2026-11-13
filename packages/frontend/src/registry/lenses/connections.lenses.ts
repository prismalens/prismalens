// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const connectionsRefs = define.lens({
	id: "connections.refs",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"we forget to look at it from a different perspective or find a connections to some other feature or requirement",
		where: "operator, organizer session, 2026-11-11 08:46Z",
	},
	conditions: ["connections.refs"],
	rubric:
		"Look at each feature from another feature's side: what it should link to, count, filter by or tell, and where a surface stands alone with no way in or out.",
	status: "active",
});
