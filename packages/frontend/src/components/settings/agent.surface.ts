// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** One agent's page header: its ⋯ and right-click list the agent's own lines (#1180). */
export const agentDetail = defineSurface({
	id: "agent.detail",
	label: "Agent actions",
	menus: {
		more: ["agent.update", "agent.changeAccount", "-", "agent.signOut"],
		context: ["agent.update", "agent.changeAccount", "-", "agent.signOut"],
	},
	states: { default: "agent-detail-actions", phone: "agent-detail-actions" },
	marks: [],
});

/** The Agents list header: Check all, and Update all once two or more agents show Update. */
export const agentList = defineSurface({
	id: "agent.list",
	label: "Agents actions",
	menus: {
		context: ["agent.checkAll", "agent.updateAll"],
		more: ["agent.checkAll", "agent.updateAll"],
	},
	states: { default: "settings-agent-checks", phone: "settings-agent-checks" },
	marks: [],
});
