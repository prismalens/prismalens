// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Check, MonitorSmartphone } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/** A composer draft another device changed: which copy to keep. */
export interface DraftCtx {
	keepMine: () => void;
	useTheirs: () => void;
	facts: Facts<never>;
}

/** The draft object: the context its actions run with. */
export const draftObject = defineObject<DraftCtx>("draft");

export const draftKeepMine = defineAction({
	id: "draft.keepMine",
	label: "Keep mine",
	icon: Check,
	run: (c) => c.keepMine(),
});

export const draftUseTheirs = defineAction({
	id: "draft.useTheirs",
	label: "Use theirs",
	icon: MonitorSmartphone,
	run: (c) => c.useTheirs(),
});
