// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, PanelRightOpen } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A sub-agent's node in the transcript; Open is also the node's click. */
export interface SubagentCtx {
	title: string;
	onOpen?: () => void;
	facts: Facts<"openable">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		subagent: SubagentCtx;
	}
	interface ObjectStates {
		subagent: "openable";
	}
	interface ActionObjects {
		"subagent.open": "subagent";
		"subagent.copyTitle": "subagent";
	}
}

export const subagentOpen = defineAction({
	id: "subagent.open",
	label: "Open",
	icon: PanelRightOpen,
	when: (f) => !!f.is?.openable,
	run: (c) => c.onOpen?.(),
});

export const subagentCopyTitle = defineAction({
	id: "subagent.copyTitle",
	label: "Copy title",
	icon: Copy,
	run: (c) => void copyText(c.title),
});
