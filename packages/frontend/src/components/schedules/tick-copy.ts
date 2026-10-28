// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ScheduleTick } from "@prismalens/contracts";

export type Tone = "ok" | "bad" | "warn" | "live" | "muted";

export interface TickLine {
	tone: Tone;
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
				text: "Skipped: the previous run was still going",
				link: null,
			};
		case "skipped_agent_not_ready":
			return {
				tone: "muted",
				text: `Skipped: ${t.reason ?? "the agent was not ready to run"}`,
				link: null,
			};
		case "skipped_bindings_changed":
			return {
				tone: "warn",
				text: "Skipped and paused: the service's repositories or notes changed",
				link: null,
			};
		case "expired_host_busy":
			return {
				tone: "muted",
				text: "Not started: PrismaLens was busy with other runs",
				link: r ? { kind: "run", id: r.id, label: "Open run" } : null,
			};
	}
	const late =
		t.outcome === "late_started"
			? `Ran late at ${time(t.decidedAt)}${t.reason === "asleep" ? " after sleep" : t.reason === "off" ? " after PrismaLens was off" : ""}: `
			: "";
	if (!r) return { tone: "muted", text: `${late || "Started"}`, link: null };
	const open = { kind: "run" as const, id: r.id, label: "Open run" };
	const lower = (s: string) =>
		late ? s.charAt(0).toLowerCase() + s.slice(1) : s;
	if (r.status === "pending" || r.status === "running")
		return {
			tone: "live",
			text: `${late}${lower(r.status === "running" ? "Running now" : "Waiting to start")}`,
			link: open,
		};
	if (r.status === "failed")
		return {
			tone: "bad",
			text: `${late}${lower(`Failed: ${r.error ?? "the run stopped"}`)}`,
			link: open,
		};
	if (r.status === "cancelled")
		return { tone: "muted", text: `${late}${lower("Stopped")}`, link: open };
	if (r.incidentId)
		return {
			tone: "warn",
			text: `${late}${lower(`Found a likely cause: INC-${r.incidentNumber}`)}`,
			link: {
				kind: "incident",
				id: r.incidentId,
				label: `Open INC-${r.incidentNumber}`,
			},
		};
	return {
		tone: "ok",
		text: `${late}${lower("Nothing wrong found")}`,
		link: open,
	};
}
