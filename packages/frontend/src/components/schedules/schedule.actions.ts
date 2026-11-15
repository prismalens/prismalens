// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Copy,
	Link2,
	Pause,
	Pencil,
	Play,
	SquareArrowOutUpRight,
	Trash2,
	Zap,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A schedule's card in the Schedules list, or its own page's header. */
export interface ScheduleCtx {
	href: string;
	open: () => void;
	runNow: () => void;
	setEnabled: (on: boolean) => void;
	/** The page's own dialogs; the list card has none. */
	edit?: () => void;
	duplicate?: () => void;
	remove?: () => void;
	facts: Facts<"enabled" | "editable" | "busy" | "page">;
}

/** The schedule object: the context its actions run with and the states they test. */
export const scheduleObject = defineObject<
	ScheduleCtx,
	"enabled" | "editable" | "busy" | "page"
>("schedule");

export const scheduleOpen = defineAction({
	id: "schedule.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	run: (c) => c.open(),
});

export const scheduleRunNow = defineAction({
	id: "schedule.runNow",
	label: "Run now",
	icon: Zap,
	when: (f) => !!f.is?.editable,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.runNow(),
});

export const schedulePause = defineAction({
	id: "schedule.pause",
	label: "Pause",
	icon: Pause,
	when: (f) => !!f.is?.editable && !!f.is?.enabled,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.setEnabled(false),
});

export const scheduleResume = defineAction({
	id: "schedule.resume",
	label: "Resume",
	icon: Play,
	when: (f) => !!f.is?.editable && !f.is?.enabled,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.setEnabled(true),
});

export const scheduleCopyLink = defineAction({
	id: "schedule.copyLink",
	label: "Copy link",
	icon: Link2,
	run: (c) => void copyText(c.href),
});

export const scheduleEdit = defineAction({
	id: "schedule.edit",
	label: "Edit",
	icon: Pencil,
	when: (f) => !!f.is?.editable && !!f.is?.page,
	run: (c) => c.edit?.(),
});

export const scheduleDuplicate = defineAction({
	id: "schedule.duplicate",
	label: "Duplicate",
	icon: Copy,
	when: (f) => !!f.is?.editable && !!f.is?.page,
	run: (c) => c.duplicate?.(),
});

export const scheduleDelete = defineAction({
	id: "schedule.delete",
	label: "Delete schedule",
	icon: Trash2,
	destructive: true,
	when: (f) => !!f.is?.editable && !!f.is?.page,
	run: (c) => c.remove?.(),
});
