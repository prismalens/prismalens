// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Schedule, ScheduleTick } from "@prismalens/contracts";
import type { StatusKind } from "@/components/kit";

/** What a schedule is about, in the list and on its page (#1020). */
export function aboutText(
	s: Pick<Schedule, "subject" | "serviceName" | "repositoryName">,
): string {
	if (s.subject === "service") return `Check ${s.serviceName}`;
	if (s.subject === "project") return s.repositoryName ?? "A project";
	return "No project";
}

export type Tone = "ok" | "bad" | "warn" | "live" | "muted";

export interface TickLine {
	tone: Tone;
	/** The closed-set status the row shows with the kit Status (#1101). */
	status: StatusKind;
	text: string;
	link: { kind: "run" | "incident"; id: string; label: string } | null;
}

const runs = (n: number, overflow: boolean) =>
	overflow ? "many runs" : n === 1 ? "a run" : `${n} runs`;

/** One history row in words (#979): what the slot became, and where to look. */
export function tickLine(
	t: ScheduleTick,
	time: (iso: string) => string,
): TickLine {
	const r = t.run;
	const missed = (why: string): TickLine => ({
		tone: "muted",
		status: "idle",
		text:
			t.missedCount > 1 || t.missedOverflow
				? `Missed ${runs(t.missedCount, t.missedOverflow)}: ${why}`
				: `Missed: ${why}`,
		link: null,
	});
	switch (t.outcome) {
		case "missed_asleep":
			return missed("this computer was asleep");
		case "missed_off":
			return missed("PrismaLens was off");
		case "missed_late":
			return missed("PrismaLens was not running checks at that time");
		case "skipped_overlap":
			return {
				tone: "muted",
				status: "idle",
				text: "Skipped: the previous run was still going",
				link: null,
			};
		case "skipped_agent_not_ready":
			return {
				tone: "muted",
				status: "idle",
				text: `Skipped: ${t.reason ?? "the agent was not ready to run"}`,
				link: null,
			};
		case "skipped_bindings_changed":
			return {
				tone: "warn",
				status: "blocked",
				text: "Skipped and paused: the service's repositories or notes changed",
				link: null,
			};
		case "expired_host_busy":
			return {
				tone: "muted",
				status: "idle",
				text: "Not started: PrismaLens was busy with other runs",
				link: r ? { kind: "run", id: r.id, label: "Open run" } : null,
			};
	}
	const late =
		t.outcome === "late_started"
			? `Ran late at ${time(t.decidedAt)}${t.reason === "asleep" ? " after sleep" : t.reason === "off" ? " after PrismaLens was off" : ""}: `
			: "";
	if (!r)
		return {
			tone: "muted",
			status: "idle",
			text: `${late || "Started"}`,
			link: null,
		};
	const open = { kind: "run" as const, id: r.id, label: "Open run" };
	const lower = (s: string) =>
		late ? s.charAt(0).toLowerCase() + s.slice(1) : s;
	// A run waiting on its agent's limit is Limited, whatever its status says (#1101).
	if (r.limit)
		return {
			tone: "warn",
			status: "limited",
			text: `${late}${lower(limitLine(r.limit.resetsAt, time))}`,
			link: open,
		};
	if (r.status === "pending" || r.status === "running")
		return {
			tone: "live",
			status: r.status === "running" ? "working" : "waiting",
			text: `${late}${lower(r.status === "running" ? "Running now" : "Waiting to start")}`,
			link: open,
		};
	if (r.status === "failed")
		return {
			tone: "bad",
			status: "failed",
			text: `${late}${lower(`Failed: ${firstLine(r.error) ?? firstLine(r.summary) ?? "the run stopped"}`)}`,
			link: open,
		};
	if (r.status === "cancelled")
		return {
			tone: "muted",
			status: "done",
			text: `${late}${lower("Stopped")}`,
			link: open,
		};
	if (r.incidentId)
		return {
			tone: "warn",
			status: "done",
			text: `${late}${lower(`Found a likely cause: INC-${r.incidentNumber}`)}`,
			link: {
				kind: "incident",
				id: r.incidentId,
				label: `Open INC-${r.incidentNumber}`,
			},
		};
	const answer = firstLine(r.summary);
	return {
		tone: "ok",
		status: "done",
		text: `${late}${lower(answer ?? "Nothing wrong found")}`,
		link: open,
	};
}

/** The first non-empty line of a run's answer or error, or null. */
function firstLine(text: string | null | undefined): string | null {
	const line = text
		?.split(/\r?\n/)
		.map((l) => l.trim())
		.find(Boolean);
	return line || null;
}

/** A run waiting on its agent's usage limit (#1101 category 22 item 5). */
export function limitLine(
	resetsAt: string | null,
	time: (iso: string) => string,
): string {
	return resetsAt
		? `Usage limit, resets ${time(resetsAt)}`
		: "Usage limit, reset time unknown";
}

/**
 * Which sentence the schedule page puts above its runs for the newest slot: a
 * failure, a late start after sleep, or none. A run held by a limit is not a failure.
 */
export function latestNote(t: ScheduleTick): "failed" | "asleep" | null {
	if (t.run?.status === "failed" && !t.run.limit) return "failed";
	if (t.outcome === "late_started" && t.reason === "asleep") return "asleep";
	return null;
}
