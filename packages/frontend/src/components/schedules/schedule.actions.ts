// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link2, Pause, Play, SquareArrowOutUpRight, Zap } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A schedule's card in the Schedules list. */
export interface ScheduleCtx {
	href: string;
	open: () => void;
	runNow: () => void;
	setEnabled: (on: boolean) => void;
	facts: Facts<"enabled" | "editable" | "busy">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		schedule: ScheduleCtx;
	}
	interface ObjectStates {
		schedule: "enabled" | "editable" | "busy";
	}
	interface ActionObjects {
		"schedule.open": "schedule";
		"schedule.runNow": "schedule";
		"schedule.pause": "schedule";
		"schedule.resume": "schedule";
		"schedule.copyLink": "schedule";
	}
}

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
