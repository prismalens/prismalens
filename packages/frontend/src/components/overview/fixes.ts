// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	FixCheck as CheckResult,
	FixCheckReason,
	Fixes,
	FixOption,
	FixVerdict,
	MetricUnit,
	RootCauseCategory,
	Threshold,
} from "@prismalens/contracts";
import { isAlertFiring, REFIRE_LABEL } from "@prismalens/contracts";
import { failureWords } from "@/lib/failure-words";
import { formatClock } from "@/lib/format-time";
import { formatValue } from "./impact";

export type { FixOption };
export const AUTO_CHECK_MS = 5 * 60_000;

/**
 * The header's Cause: the one you recorded at Resolve outranks the standing report's
 * (#673 w8-21). The report's "unknown" is no category, not "cause unknown" (w9-3).
 */
export function causeCategory(
	recorded: RootCauseCategory | null | undefined,
	reported: RootCauseCategory | null | undefined,
): RootCauseCategory | null {
	if (recorded) return recorded;
	return reported && reported !== "unknown" ? reported : null;
}

/** The run's ways to stop the impact (0 to 3, in rank order) and its one lasting fix. */
export function splitOptions(fixes: Fixes | undefined): {
	stop: FixOption[];
	lasting: FixOption | null;
} {
	const options = [...(fixes?.options ?? [])].sort((a, b) => a.index - b.index);
	return {
		stop: options.filter((o) => o.kind === "stop-impact").slice(0, 3),
		lasting: options.find((o) => o.kind === "lasting") ?? null,
	};
}

/** A capitalised word, then a sentence's end or no shell characters at all: prose, not a command. */
const SENTENCE = /^[A-Z][a-z]+[ ,](?:[^\n]*[.!]|[^\n|$=;&<>`/\\-]*)$/;

/** The option's command, or null when its `command` is a sentence: that reads as text, never Copy or apply (#673 w8-15). */
export function commandOf(option: Pick<FixOption, "command">): string | null {
	const c = option.command?.trim();
	return c && !SENTENCE.test(c) ? c : null;
}

/** The sentence an agent wrote where a command goes. */
export function noteOf(option: Pick<FixOption, "command">): string | null {
	const c = option.command?.trim();
	return c && SENTENCE.test(c) ? c : null;
}

/** A note that opens with a negation says there is nothing to do; any other is a step done by hand (#834 review). */
const NO_ACTION = /^(?:None|No|Nothing|Not|Never|Don't|Do not)\b/;

export function nothingToRun(option: Pick<FixOption, "command">): boolean {
	const note = noteOf(option);
	return !!note && NO_ACTION.test(note);
}

/** One check result: the live answer has its value; after a reload only the verdict and time. */
export interface FixCheck {
	verdict: FixVerdict;
	at: string;
	value?: number | null;
	retryable?: boolean;
	reason?: FixCheckReason | null;
}

/** A live check as the strip keeps it: the server's words are dropped so a reload reads the same. */
export const liveCheck = (r: CheckResult): FixCheck => ({
	verdict: r.verdict,
	at: r.checkedAt,
	value: r.value,
	retryable: r.retryable,
	reason: r.reason,
});

export type FixStage =
	| { stage: "ready"; copied: boolean; copyFailed: boolean }
	| { stage: "applied"; appliedAt: string }
	| { stage: "checking"; appliedAt: string }
	| { stage: "checked"; appliedAt: string; check: FixCheck }
	| { stage: "worked"; appliedAt: string; clearedAt: string };

/**
 * Where one option stands: copied this session, applied (its row's
 * implementedAt), checking, its last check, or worked once every alert
 * cleared after it was applied.
 */
export function fixStage(input: {
	option: Pick<FixOption, "appliedAt" | "lastCheck">;
	copied: boolean;
	copyFailed?: boolean;
	checking: boolean;
	/** This session's check, newer than the option's recorded one. */
	check: FixCheck | null;
	alerts: readonly { status: string; resolvedAt: string | null }[];
}): FixStage {
	const appliedAt = input.option.appliedAt;
	if (!appliedAt)
		return {
			stage: "ready",
			copied: input.copied,
			copyFailed: !!input.copyFailed,
		};
	const cleared = clearedAfter(input.alerts, appliedAt);
	if (cleared) return { stage: "worked", appliedAt, clearedAt: cleared };
	if (input.checking) return { stage: "checking", appliedAt };
	const check = input.check ?? input.option.lastCheck;
	if (check && Date.parse(check.at) >= Date.parse(appliedAt)) {
		if (check.verdict === "it_worked")
			return { stage: "worked", appliedAt, clearedAt: check.at };
		return { stage: "checked", appliedAt, check };
	}
	return { stage: "applied", appliedAt };
}

/** When the last alert cleared, if every alert is clear and the last cleared after `after`. */
function clearedAfter(
	alerts: readonly { status: string; resolvedAt: string | null }[],
	after: string,
): string | null {
	if (alerts.length === 0 || alerts.some((a) => isAlertFiring(a.status)))
		return null;
	const last = alerts
		.map((a) => a.resolvedAt ?? "")
		.sort()
		.at(-1);
	return last && Date.parse(last) > Date.parse(after) ? last : null;
}

export type NextActionId =
	| "copy"
	| "applied"
	| "check"
	| "next-option"
	| "resolve"
	| "retry"
	| "investigate"
	| "watch";

/** A Next action that starts a run, so it waits for the box's agent to load. */
export function startsRun(id: NextActionId): boolean {
	return id === "investigate" || id === "retry";
}

export interface NextStrip {
	tone: "accent" | "plain" | "live" | "warn" | "ok" | "danger";
	text: string;
	primary?: { id: NextActionId; label: string };
	secondary?: { id: NextActionId; label: string };
	/** Another incident, linked after the text: the refire, or the merge's survivor. */
	link?: { incidentId: string; label: string };
}

/** `just after you applied it` inside a minute, never "0 minutes" (#673 w8-22). */
export function afterApplied(from: string, to: string): string {
	const m = Math.max(
		0,
		Math.round((Date.parse(to) - Date.parse(from)) / 60_000),
	);
	if (m === 0) return "just after you applied it";
	return `${m === 1 ? "1 minute" : `${m} minutes`} after you applied it`;
}

/**
 * Where the series stands against the rule, from its operator: `up == 0`
 * is not "over" anything. A check's value is never stored (ADR 0006 §1).
 */
export function againstRule(
	op: Threshold["op"] | undefined,
	firing: boolean,
): string {
	// The side that includes the threshold itself says "at or" (#834 review).
	if (op === undefined || op === ">" || op === ">=")
		return firing
			? `still ${op === ">=" ? "at or above" : "over"} the alert threshold`
			: `${op === ">" ? "At or below" : "Below"} the alert threshold`;
	if (op === "<" || op === "<=")
		return firing
			? `still ${op === "<=" ? "at or below" : "under"} the alert threshold`
			: `${op === "<" ? "At or above" : "Above"} the alert threshold`;
	return firing
		? "still matching the alert's rule"
		: "No longer matching the alert's rule";
}

/** A failed run on the Next strip; a signed-out agent names itself and the fix (#831 v5-39). */
export function failedStrip(
	name: string,
	error: string | null | undefined,
	agent: string | undefined,
): { name: string; reason: string; next?: string } {
	const words = failureWords(error, agent ?? "the agent");
	return words.plain && words.next
		? { name, reason: words.what, next: words.next }
		: { name, reason: words.what };
}

/**
 * The Next strip (spec screen 2): the single next action for the incident,
 * from the top fix option's stage, else the run's state.
 */
export function nextStrip(input: {
	/** The operator resolved it (stored `closed`); Alerts cleared is `cleared`, not this. */
	ended: boolean;
	/** The cause you recorded at Resolve, shown once it ended (#673 w8-21). */
	cause?: string | null;
	/** The incident this one was merged into. */
	mergedInto?: { id: string; number: number } | null;
	/** The incident this one's alert fired again as (the detail's `refiredAs`). */
	refiredAs?: { id: string; number: number } | null;
	/** Every alert cleared and nobody resolved it yet. */
	cleared: boolean;
	/** Stored `resolved`: the source ended it; it reads Alerts cleared before any fix step. */
	alertsCleared?: boolean;
	runs: number;
	/** `waiting`: its agent waits on your Approve or Deny (#673 w5-14). */
	live: { name: string; waiting?: boolean } | null;
	/** `next`: what to do first, when the failure has a known fix (#831 v5-39). */
	failed: { name: string; reason: string; next?: string } | null;
	reported: boolean;
	option: FixOption | null;
	stage: FixStage | null;
	/** Check now can judge this alert (Q1c A); also stands in for a check saved without `retryable`. */
	checkable: boolean;
	hasNextOption: boolean;
	/** The charted metric's unit, so a check's value reads as the Impact card does. */
	unit?: MetricUnit | null;
	/** The alert rule's threshold, so a check is worded by its operator (#673 w8-20). */
	threshold?: Threshold | null;
	/** The run flagged text that tried to instruct it: Copy happens beside the warning only (#673 w8-19). */
	flagged?: boolean;
}): NextStrip {
	const { option, stage } = input;
	if (input.mergedInto)
		return {
			tone: "plain",
			text: "Merged into",
			link: {
				incidentId: input.mergedInto.id,
				label: `INC-${input.mergedInto.number}`,
			},
		};
	const resolved = input.cause?.trim()
		? `Resolved. Your recorded cause: ${input.cause.trim().replace(/\.$/, "")}.`
		: "Resolved.";
	if (input.ended)
		return input.refiredAs
			? {
					tone: "plain",
					text: resolved,
					link: {
						incidentId: input.refiredAs.id,
						label: `${REFIRE_LABEL} as INC-${input.refiredAs.number}`,
					},
				}
			: {
					tone: "plain",
					text: `${resolved} If the alert fires again, PrismaLens opens a new incident and links it here.`,
				};
	if (input.alertsCleared)
		return input.refiredAs
			? {
					tone: "ok",
					text: "Alerts cleared, and the alert fired again as a new incident. Resolve this one.",
					primary: { id: "resolve", label: "Resolve" },
					link: {
						incidentId: input.refiredAs.id,
						label: `${REFIRE_LABEL} as INC-${input.refiredAs.number}`,
					},
				}
			: CLEARED;
	if (option && stage) {
		const prefix = input.live
			? `${input.live.name} is checking this again; you can still apply it. `
			: "";
		switch (stage.stage) {
			case "ready":
				if (stage.copyFailed)
					return {
						tone: "accent",
						text: `${prefix}This browser blocked the clipboard, so the command under Stop the impact is selected. Copy it with Ctrl+C, run it, then tell PrismaLens.`,
						...(option.readOnly
							? {}
							: { primary: { id: "applied", label: "I applied it" } }),
					};
				if (nothingToRun(option))
					return {
						tone: "plain",
						text: `${prefix}${option.title}. There is nothing to run; the reason is under Stop the impact.`,
					};
				if (!option.command || noteOf(option))
					return {
						tone: "accent",
						text: `${prefix}${option.title}. The steps are under Stop the impact.`,
						...(option.readOnly
							? {}
							: { primary: { id: "applied", label: "I applied it" } }),
					};
				if (stage.copied && !option.readOnly)
					return {
						tone: "accent",
						text: `${prefix}Command copied. Run it, then tell PrismaLens so it can check the result.`,
						primary: { id: "applied", label: "I applied it" },
						...(input.flagged
							? {}
							: { secondary: { id: "copy", label: "Copy again" } }),
					};
				if (input.flagged)
					return {
						tone: "warn",
						text: `${prefix}${option.title}. The agent flagged text that tried to instruct it; read the command and its warning under Stop the impact before you copy it.`,
					};
				return {
					tone: "accent",
					text: `${prefix}${option.title}. The command is under Stop the impact.`,
					primary: { id: "copy", label: "Copy command" },
				};
			case "applied":
				return input.checkable
					? {
							tone: "plain",
							text: `Applied at ${formatClock(stage.appliedAt)}. PrismaLens checks the alert again at ${formatClock(Date.parse(stage.appliedAt) + AUTO_CHECK_MS)}.`,
							primary: { id: "check", label: "Check now" },
						}
					: {
							tone: "plain",
							text: `Applied at ${formatClock(stage.appliedAt)}. PrismaLens cannot check this alert; if the fix worked, the alert clears on its own.`,
						};
			case "checking":
				return { tone: "live", text: "Asking the metrics source." };
			case "checked": {
				const c = stage.check;
				const value = c.value != null ? formatValue(c.value, input.unit) : null;
				if (c.verdict === "not_yet")
					return {
						tone: "warn",
						text: `Not yet: ${value ? `${value} at ${formatClock(c.at)}` : `${againstRule(input.threshold?.op, true)} at ${formatClock(c.at)}`}, ${afterApplied(stage.appliedAt, c.at)}. Some fixes take a few minutes to settle.`,
						primary: { id: "check", label: "Check again" },
						...(input.hasNextOption
							? {
									secondary: {
										id: "next-option",
										label: "Try the next option",
									},
								}
							: {}),
					};
				if (c.verdict === "below_threshold")
					return {
						tone: "plain",
						text: `${againstRule(input.threshold?.op, false)}${value ? `: ${value}` : ""} at ${formatClock(c.at)}. The alert clears on its own once its rule sees the recovery.`,
						primary: { id: "check", label: "Check again" },
					};
				return (c.retryable ?? input.checkable)
					? {
							tone: "warn",
							text: `Could not check at ${formatClock(c.at)}. The fix may still have worked.`,
							primary: { id: "check", label: "Try again" },
						}
					: {
							tone: "warn",
							text: "Could not check; the alert clears on its own once its rule sees the recovery.",
						};
			}
			case "worked":
				return {
					tone: "ok",
					text: `It worked: the alert cleared at ${formatClock(stage.clearedAt)}. Resolve the incident, or leave it until you are sure.`,
					primary: { id: "resolve", label: "Resolve" },
				};
		}
	}
	if (input.cleared) return CLEARED;
	if (input.live?.waiting)
		return {
			tone: "warn",
			text: `${input.live.name} waits for your approval. Approve or deny it in the box below.`,
		};
	if (input.live)
		return {
			tone: "live",
			text: `${input.live.name} is investigating. Its finding and any way to stop the impact land on this page.`,
			primary: { id: "watch", label: "Watch" },
		};
	if (input.failed && !input.reported)
		return {
			tone: "danger",
			text: input.failed.next
				? `${input.failed.name} stopped before a finding. ${input.failed.reason} ${input.failed.next}`
				: `Retry the investigation. ${input.failed.name} stopped before a finding: ${lowerFirst(input.failed.reason)}`,
			primary: { id: "retry", label: "Retry run" },
		};
	if (input.runs === 0)
		return {
			tone: "accent",
			text: "No run yet. Investigate to find the cause and a way to stop the impact.",
			primary: { id: "investigate", label: "Investigate" },
		};
	if (input.reported)
		return {
			tone: "plain",
			text: "The agent found nothing to undo or switch off right away. The cause and the lasting fix are under Why.",
		};
	return {
		tone: "plain",
		text: "The last run ended without a finding. Investigate again with what you know.",
		primary: { id: "investigate", label: "Investigate again" },
	};
}

const CLEARED: NextStrip = {
	tone: "ok",
	text: "Every alert has cleared. Resolve the incident, or investigate again if it comes back.",
	primary: { id: "resolve", label: "Resolve" },
};

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
