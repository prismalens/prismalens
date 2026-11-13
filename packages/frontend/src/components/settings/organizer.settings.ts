// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const organizerAgentsMayStartThreads = define.setting({
	id: "organizer.agentsMayStartThreads",
	page: "organizer",
	anchor: "agent-threads-start-row",
	label: "Agents may start threads",
	sentence: "Each runs beside its starter and costs its own turns.",
	also: "ask allow never organizer",
});
