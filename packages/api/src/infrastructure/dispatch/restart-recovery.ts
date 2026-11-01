// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The rules for taking up a run PrismaLens's own stop cut off (#981): which runs
 * resume, and the message that tells the agent what happened while it was away.
 * The boot step that applies them is `DispatchService.tryRecover`.
 */

import { fenceUntrusted, sanitizeUntrustedLine } from "@prismalens/engine";

/** A run resumes on its own only within this long of its last activity: older state has moved on. */
export const RESUME_WITHIN_MS = 24 * 60 * 60_000;
/** Consecutive recoveries of one run; T3 Code stops at three continuations per chain. */
export const RESTART_ATTEMPT_CAP = 3;
/** A start this soon after the last one that resumed runs is read as a crash loop. */
export const BOOT_LOOP_MS = 2 * 60_000;
/** Recovered runs wait this long for the alert catch-up, so the message can list what fired. */
export const RECOVERY_DELAY_MS = 30_000;

export const NOT_RESUMED = "Not resumed: ";

export interface RecoveryInput {
	enabled: boolean;
	now: Date;
	lastActivityAt: Date;
	/** This recovery's attempt number: 1 for the first. */
	attempt: number;
	bootLoop: boolean;
	/** The agent from before the stop is proven gone. */
	contained: boolean;
	agent: string;
	/** Why the agent can't start now (not installed, signed out, model refused), or null. */
	preflight: string | null;
}

/** Null when the run resumes, else the reason, phrased for the run page after "Not resumed: ". */
export function notResumedReason(i: RecoveryInput): string | null {
	if (!i.enabled) return "Resume after a restart is off in Settings.";
	if (!i.contained)
		return `${i.agent} from before the restart may still be running, so a second one wasn't started. Resume once it has stopped.`;
	if (i.bootLoop)
		return "PrismaLens stopped again within 2 minutes of resuming runs, so it resumed none this time.";
	if (i.attempt > RESTART_ATTEMPT_CAP)
		return `PrismaLens stopped again during each of the last ${RESTART_ATTEMPT_CAP} resumes of this run, so it stopped trying.`;
	const off = i.now.getTime() - i.lastActivityAt.getTime();
	if (off > RESUME_WITHIN_MS)
		return `PrismaLens was off for ${span(off)}, and a run resumes on its own only within a day of stopping. What it was checking may have moved on.`;
	if (i.preflight) return i.preflight;
	return null;
}

/** "22 minutes", "5 hours", "2 days". */
export function span(ms: number): string {
	const min = Math.max(1, Math.round(ms / 60_000));
	if (min < 90) return `${min} minute${min === 1 ? "" : "s"}`;
	const h = Math.round(min / 60);
	if (h < 48) return `${h} hours`;
	return `${Math.round(h / 24)} days`;
}

export type WorkspaceState =
	| { repo: string | null; state: "as-was"; head: string }
	| { repo: string | null; state: "changed"; head: string; changed: number }
	| { repo: string | null; state: "moved"; head: string; recorded: string }
	| { repo: string | null; state: "rebuilt"; head: string };

export interface RestartFacts {
	stoppedAt: Date;
	resumedAt: Date;
	/** Renders times; the host's own clock, with its offset named once. */
	timeZone?: string;
	turn: "report" | "answer";
	/** The operator's question an interrupted answer was for. */
	question?: string;
	alerts: {
		/** `none`: no alert source to check; `unchecked`: the catch-up did not finish. */
		catchUp: "done" | "unchecked" | "none";
		fired: { title: string; at: Date }[];
		resolved: { title: string; at: Date }[];
	};
	deniedAsks: string[];
	workspace: WorkspaceState[];
	snapshot: "available" | "unavailable" | "none";
}

const LIST_MAX = 5;

/** The message PrismaLens sends the resumed session; recorded as PrismaLens's, not the operator's. */
export function composeRestartMessage(f: RestartFacts): string {
	const clock = (d: Date) => time(d, f.timeZone);
	const parts = [
		`PrismaLens stopped at ${clock(f.stoppedAt)} and started again at ${clock(f.resumedAt)} (${offsetName(f.resumedAt, f.timeZone)}), ${span(f.resumedAt.getTime() - f.stoppedAt.getTime())} later. Your last command may or may not have completed: check before relying on its effect.`,
	];
	const happened: string[] = [];
	if (f.alerts.fired.length)
		happened.push(
			`${count(f.alerts.fired.length, "alert")} fired on this incident`,
		);
	if (f.alerts.resolved.length)
		happened.push(`${count(f.alerts.resolved.length, "alert")} resolved`);
	if (happened.length)
		parts.push(
			`While PrismaLens was stopped, ${happened.join(" and ")}; the ${ALERTS_BLOCK} block below names them.`,
		);
	if (f.alerts.catchUp === "unchecked")
		parts.push(
			"PrismaLens couldn't check its alert sources for the time it was stopped, so alerts that fired then may be missing here.",
		);
	for (const ask of f.deniedAsks)
		parts.push(
			`Your request to ${ask} was closed unanswered because PrismaLens stopped; ask again if you still need it.`,
		);
	parts.push(...f.workspace.map(workspaceLine));
	if (f.snapshot === "unavailable")
		parts.push("The pre-run evidence snapshot is unavailable.");
	parts.push(
		f.turn === "answer" && f.question
			? `You were answering: "${f.question}". Answer it.`
			: "Continue the investigation from your last step.",
	);
	const text = parts.join(" ");
	if (!happened.length) return text;
	// Alert names are whoever wrote the rule's words: data, never instructions (#981 OBJ-018).
	const lines = [
		...listed("fired", f.alerts.fired, clock),
		...listed("resolved", f.alerts.resolved, clock),
	];
	const block = fenceUntrusted(
		ALERTS_BLOCK,
		"Alert names copied from the alerting system while PrismaLens was stopped.",
		lines.join("\n"),
	);
	return `${text}\n\n${block}`;
}

const ALERTS_BLOCK = "ALERTS_WHILE_STOPPED";

function workspaceLine(w: WorkspaceState): string {
	const where = w.repo ? `Your workspace for ${w.repo}` : "Your workspace";
	const at = (sha: string) => sha.slice(0, 7);
	switch (w.state) {
		case "as-was":
			return `${where} is at commit ${at(w.head)}, as it was.`;
		case "changed":
			return `${where} is at commit ${at(w.head)} with ${count(w.changed, "changed file")} (git status), which may include your edits from before the stop.`;
		case "moved":
			return `${where} is at commit ${at(w.head)}, not ${at(w.recorded)} as recorded.`;
		case "rebuilt":
			return `${where} was removed while PrismaLens was stopped and has been rebuilt at commit ${at(w.head)}; changes you made to its files before the stop are gone.`;
	}
}

function listed(
	verb: string,
	items: { title: string; at: Date }[],
	clock: (d: Date) => string,
): string[] {
	const shown = items
		.slice(0, LIST_MAX)
		.map((a) => `${verb} at ${clock(a.at)}: ${sanitizeUntrustedLine(a.title)}`);
	const more = items.length - shown.length;
	return more > 0 ? [...shown, `${more} more ${verb}`] : shown;
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function time(d: Date, timeZone?: string): string {
	return d.toLocaleString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		day: "numeric",
		month: "short",
		hour12: false,
		...(timeZone ? { timeZone } : {}),
	});
}

function offsetName(d: Date, timeZone?: string): string {
	const part = new Intl.DateTimeFormat("en-GB", {
		timeZoneName: "shortOffset",
		...(timeZone ? { timeZone } : {}),
	})
		.formatToParts(d)
		.find((p) => p.type === "timeZoneName");
	const name = (part?.value ?? "GMT").replace(/^GMT(\+0)?$/, "GMT");
	return `times ${name === "GMT" ? "UTC" : name.replace(/^GMT/, "UTC")}`;
}
