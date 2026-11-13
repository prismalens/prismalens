// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link2, RotateCcw } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** One row on a Settings page. */
export interface SettingCtx {
	/** A link that lands on the row (Settings search's anchor). */
	link: string;
	reset: () => void;
	facts: Facts<"changed" | "linkable">;
}

/** The setting object: the context its actions run with and the states they test. */
export const settingObject = defineObject<SettingCtx, "changed" | "linkable">(
	"setting",
);

export const settingReset = defineAction({
	id: "setting.reset",
	label: "Reset to default",
	icon: RotateCcw,
	when: (f) => !!f.is?.changed,
	run: (c) => c.reset(),
});

export const settingCopyLink = defineAction({
	id: "setting.copyLink",
	label: "Copy link",
	icon: Link2,
	when: (f) => !!f.is?.linkable,
	run: (c) => void copyText(c.link),
});
