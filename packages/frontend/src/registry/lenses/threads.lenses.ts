// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const threadsFlat = define.lens({
	id: "threads.flat",
	group: "product",
	said: {
		date: "2026-11-13",
		quote:
			"threads are flat, independent siblings, with no parent tree and no grouping in the sidebar",
		where:
			"operator, standing decision on #1101 - Wave 2: thread UX hill climb, round 2",
	},
	conditions: ["threads.many"],
	check: {
		script: "packages/frontend/src/registry/threads-flat.guard.test.tsx",
		measure:
			"thread rows or Home cards inside another row, a fold, a group or a starter's count",
		budget: 0,
	},
	rubric:
		"Every thread is its own row in the sidebar, Needs you and Home. Who started it is a mark on the row, never a container, chevron or count. Many agent-started rows are sunk or filtered, not folded.",
	status: "active",
});
