// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"subagent.node": "subagent";
	}
}

export const subagentNode = defineSurface({
	id: "subagent.node",
	label: "Sub-agent actions",
	menus: { context: ["subagent.open", "subagent.copyTitle"] },
	states: { default: "subagent-node", phone: "subagent-node" },
	marks: ["status"],
});
