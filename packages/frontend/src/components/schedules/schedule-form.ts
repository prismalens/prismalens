// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RecurrenceInput } from "@prismalens/contracts";

export type Preset = "daily" | "weekdays" | "weekly" | "hours" | "cron";

/** The dialog's When section; every preset compiles to one stored recurrence (#979). */
export interface WhenForm {
	preset: Preset;
	/** HH:MM in `timezone`. */
	time: string;
	timezone: string;
	/** 0 Sunday … 6 Saturday. */
	days: number[];
	everyHours: number;
	startAt: string;
	cron: string;
}

const hm = (time: string) => {
	const [h = "0", m = "0"] = time.split(":");
	return { h: Number(h), m: Number(m) };
};

/** Today's `time` in `timeZone`, as an instant: the interval's anchor. */
function todayAt(time: string, timeZone: string, now: Date): Date {
	const { h, m } = hm(time);
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
	const guess = new Date(
		`${parts}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
	);
	const wall = new Date(guess.toLocaleString("en-US", { timeZone }));
	const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
	return new Date(guess.getTime() - (wall.getTime() - utc.getTime()));
}

export function recurrenceOf(f: WhenForm, now = new Date()): RecurrenceInput {
	if (f.preset === "hours")
		return {
			type: "interval",
			everyMinutes: f.everyHours * 60,
			anchorAt: todayAt(f.startAt, f.timezone, now).toISOString(),
		};
	if (f.preset === "cron")
		return { type: "cron", expr: f.cron.trim(), timezone: f.timezone };
	const { h, m } = hm(f.time);
	const dow =
		f.preset === "daily"
			? "*"
			: f.preset === "weekdays"
				? "1-5"
				: [...f.days].sort((a, b) => a - b).join(",") || "1";
	return { type: "cron", expr: `${m} ${h} * * ${dow}`, timezone: f.timezone };
}

export function defaultWhen(timezone: string): WhenForm {
	return {
		preset: "weekdays",
		time: "09:00",
		timezone,
		days: [1, 2, 3, 4, 5],
		everyHours: 6,
		startAt: "00:00",
		cron: "0 9 * * 1-5",
	};
}

/** A stored recurrence back into the preset it came from; anything else opens as Cron. */
export function formOf(r: RecurrenceInput, hostZone = "UTC"): WhenForm {
	if (r.type === "interval") {
		const startAt = new Intl.DateTimeFormat("en-GB", {
			timeZone: hostZone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).format(new Date(r.anchorAt));
		return {
			...defaultWhen(hostZone),
			preset: "hours",
			everyHours: Math.max(1, Math.round(r.everyMinutes / 60)),
			startAt,
		};
	}
	const base = { ...defaultWhen(r.timezone), cron: r.expr };
	const [minute, hour, dom, month, dow = ""] = r.expr.trim().split(/\s+/);
	if (
		!/^\d+$/.test(minute ?? "") ||
		!/^\d+$/.test(hour ?? "") ||
		dom !== "*" ||
		month !== "*"
	)
		return { ...base, preset: "cron" };
	const time = `${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`;
	if (dow === "*") return { ...base, preset: "daily", time };
	if (dow === "1-5") return { ...base, preset: "weekdays", time };
	if (/^[0-6](,[0-6])*$/.test(dow))
		return {
			...base,
			preset: "weekly",
			time,
			days: dow.split(",").map(Number),
		};
	return { ...base, preset: "cron" };
}

/** What the dialog's service field shows: a wait, a way to Services, or the picker (#984). */
export function serviceChoice(
	services: readonly { id: string }[] | undefined,
): "loading" | "none" | "pick" {
	if (!services) return "loading";
	return services.length ? "pick" : "none";
}
