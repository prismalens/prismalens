// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, PanelRightOpen } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A sub-agent's node in the transcript; Open is also the node's click. */
export interface SubagentCtx {
	title: string;
	onOpen?: () => void;
	facts: Facts<"openable">;
}

/** The subagent object: the context its actions run with and the states they test. */
export const subagentObject = defineObject<SubagentCtx, "openable">("subagent");

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
