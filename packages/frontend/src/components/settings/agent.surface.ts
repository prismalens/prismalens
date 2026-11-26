// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** Settings → Agents, the list's header: right-click and its ⋯ list these rows. */
export const agentList = defineSurface({
	id: "agent.list",
	label: "Agent actions",
	menus: { context: ["agent.checkAll"], more: ["agent.checkAll"] },
	states: { default: "settings-agent-checks", phone: "settings-agent-checks" },
	marks: [],
});
