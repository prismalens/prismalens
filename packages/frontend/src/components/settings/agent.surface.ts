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

/** The Agents list header: Update all once two or more agents show Update (#1180). */
export const agentList = defineSurface({
	id: "agent.list",
	label: "Agents actions",
	menus: { more: ["agent.updateAll"] },
	states: { default: "agent-list-actions", phone: "agent-list-actions" },
	marks: [],
});
