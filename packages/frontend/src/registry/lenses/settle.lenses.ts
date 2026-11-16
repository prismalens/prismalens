// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const settleCleanup = define.lens({
	id: "settle.cleanup",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"what about clearing things up automatically when a thread is settled or marked done",
		where:
			"operator, organizer session, 2026-11-11 08:40Z; also 2026-11-10 10:12Z, many node.exe left running",
	},
	conditions: ["settle.cleanup"],
	rubric:
		"Settling or finishing a thread ends everything it started: watches, crons, worktrees, child threads and processes. Look for what is still running afterwards.",
	status: "active",
});
