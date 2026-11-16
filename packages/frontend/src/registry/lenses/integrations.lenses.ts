// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const integrationsCost = define.lens({
	id: "integrations.cost",
	group: "product",
	said: {
		date: "2026-11-10",
		quote:
			"each integration point that we add is more technical debt that we have to maintain",
		where: "operator, organizer session, 2026-11-10 09:12Z",
	},
	conditions: ["integrations.cost"],
	rubric:
		"Parked. An integration is cheap to add, update and remove, and a break shows up as a disabled integration, not as silence.",
	status: "parked",
});
