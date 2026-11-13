// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A decided call: what it was, to copy and run by hand. */
export interface DecisionCtx {
	title: string;
	facts: Facts<never>;
}

/** The decision object: the context its actions run with. */
export const decisionObject = defineObject<DecisionCtx>("decision");

export const decisionCopy = defineAction({
	id: "decision.copy",
	label: "Copy the call",
	icon: Copy,
	run: (c) => void copyText(c.title),
});
