// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	FixCheck as CheckResult,
	FixCheckReason,
	Fixes,
	FixOption,
	FixVerdict,
	MetricUnit,
} from "@prismalens/contracts";
import { isAlertFiring, REFIRE_LABEL } from "@prismalens/contracts";
import { formatClock } from "@/lib/format-time";
import { formatValue } from "./impact";

export type { FixOption };
export const AUTO_CHECK_MS = 5 * 60_000;

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

export interface NextStrip {
	tone: "accent" | "plain" | "live" | "warn" | "ok" | "danger";
	text: string;
	primary?: { id: NextActionId; label: string };
	secondary?: { id: NextActionId; label: string };
	/** Another incident, linked after the text: the refire, or the merge's survivor. */
	link?: { incidentId: string; label: string };
}

const minutes = (from: string, to: string) => {
	const m = Math.max(
		0,
		Math.round((Date.parse(to) - Date.parse(from)) / 60_000),
	);
	return m === 1 ? "1 minute" : `${m} minutes`;
};

/**
 * The Next strip (spec screen 2): the single next action for the incident,
 * from the top fix option's stage, else the run's state.
 */
export function nextStrip(input: {
	/** The operator resolved it (stored `closed`); Alerts cleared is `cleared`, not this. */
	ended: boolean;
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
	failed: { name: string; reason: string } | null;
	reported: boolean;
	option: FixOption | null;
	stage: FixStage | null;
	/** A check can run: a metrics source answers for this alert. */
	checkable: boolean;
	hasNextOption: boolean;
	/** The charted metric's unit, so a check's value reads as the Impact card does. */
	unit?: MetricUnit | null;
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
	if (input.ended)
		return input.refiredAs
			? {
					tone: "plain",
					text: "Resolved.",
					link: {
						incidentId: input.refiredAs.id,
						label: `${REFIRE_LABEL} as INC-${input.refiredAs.number}`,
					},
				}
			: {
					tone: "plain",
					text: "Resolved. If the alert fires again, PrismaLens opens a new incident and links it here.",
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
				if (!option.command)
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
						secondary: { id: "copy", label: "Copy again" },
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
						text: `Not yet: ${value ? `${value} at ${formatClock(c.at)}` : `still over the alert threshold at ${formatClock(c.at)}`}, ${minutes(stage.appliedAt, c.at)} after you applied it. Some fixes take a few minutes to settle.`,
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
						text: `Below the alert threshold${value ? `: ${value}` : ""} at ${formatClock(c.at)}. The alert clears on its own once its rule sees the recovery.`,
						primary: { id: "check", label: "Check again" },
					};
				return c.retryable !== false
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
			text: `Retry the investigation. ${input.failed.name} stopped before a finding: ${lowerFirst(input.failed.reason)}`,
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
