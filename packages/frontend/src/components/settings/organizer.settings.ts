// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const organizerAgentsMayStartThreads = define.setting({
	id: "organizer.agentsMayStartThreads",
	page: "organizer",
	anchor: "agent-threads-start-row",
	label: "Agents may start threads",
	sentence: "Ask each time, allow within limits, or never.",
	also: "organizer delegate started",
});
