// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A row for an update the agent sent that PrismaLens does not know. */
export interface DriftCtx {
	/** The update's kind and its text, as the agent sent them. */
	text: string;
	facts: Facts<never>;
}

export const driftObject = defineObject<DriftCtx, never>("drift");

/** The raw update, for a bug report or a search (#1101, right-click). */
export const driftCopy = defineAction({
	id: "drift.copy",
	label: "Copy the update",
	icon: Copy,
	run: (c) => void copyText(c.text),
});
