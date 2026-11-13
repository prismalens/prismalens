// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const settingsDefaults = define.lens({
	id: "settings.defaults",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"having good default settings and adding controls in settings section",
		where: "operator, organizer session, 2026-11-11 08:46Z",
	},
	conditions: ["settings.defaults"],
	rubric:
		"Every setting ships with a default that works without opening Settings, a control, and a one-line description; a feature that adds behaviour adds its setting in the same change.",
	status: "active",
});
