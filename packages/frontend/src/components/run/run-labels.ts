// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	isAlertFiring,
	isRunStateLive,
	type RunCredential,
	type RunState,
	runState,
} from "@prismalens/contracts";
import type { RunRef } from "@/components/incidents/record-context";
import { runNumber } from "@/components/incidents/run-facts";
import { ago } from "@/hooks/use-now";
import { formatClock, formatDate, formatElapsed } from "@/lib/format-time";
import { isEvent } from "@/lib/trigger";
import { startedByUser, triggerWhy } from "./trigger-types";

/** `Run 2` for an investigation, `Ask` for a chat: the breadcrumb's last part (#811). */
export function viewName(
	runs: RunRef[],
	run: { id: string; kind?: string | null },
): string {
	return run.kind === "chat" ? "Ask" : `Run ${runNumber(runs, run.id)}`;
}

/** A live run whose agent waits on your Approve or Deny (#673 w5-14). */
export function waitsOnYou(run: {
	status: string;
	awaitingApprovalAt?: string | Date | null;
}): boolean {
	return isRunStateLive(runState(run.status)) && !!run.awaitingApprovalAt;
}

/** What a run came to, in two or three words. */
export function runOutcome(
	run: Pick<RunRef, "status" | "kind" | "hasReport" | "rootCause"> & {
		awaitingApprovalAt?: string | Date | null;
		endReason?: string | null;
	},
): string {
	const state = runState(run.status, { hasEvents: true });
	const chat = run.kind === "chat";
	if (waitsOnYou(run)) return "waiting for you";
	if (state === "starting") return "starting";
	if (state === "working") return chat ? "answering" : "investigating";
	if (state === "stopping") return "stopping";
	if (state === "stopped") return "stopped";
	if (state === "failed")
		return run.endReason === "interrupted" ? "interrupted" : "failed";
	if (chat) return "answered";
	if (!run.hasReport) return "ended without a report";
	return reportOutcome(run.rootCause);
}

/** A report's own outcome: it holds while a Continue on the same run works (#831 w6-21). */
export function reportOutcome(rootCause: string | null | undefined): string {
	return rootCause ? "likely cause" : "no cause named";
}

/**
 * A row in the runs menu and the sidebar (#811): `Run 2, likely cause`,
 * `Ask: did v1.41 run the same query?`.
 */
export function runLabel(runs: RunRef[], run: RunRef): string {
	if (run.kind === "chat") {
		const title = run.title?.trim();
		return title ? `Ask: ${title}` : `Ask, ${runOutcome(run)}`;
	}
	return `Run ${runNumber(runs, run.id)}, ${runOutcome(run)}`;
}

export function refRunState(run: Pick<RunRef, "status">): RunState {
	return runState(run.status, { hasEvents: true });
}

/** `now` while live, else `11h ago` from when it started. */
export function runAge(run: RunRef, now: number | null): string {
	const state = refRunState(run);
	if (state === "starting" || state === "working" || state === "stopping")
		return "now";
	return ago(run.startedAt ?? run.createdAt, now);
}

const DAY = 86_400_000;

/** `Today 01:05`, `Yesterday 23:30`, else the date and time. */
export function dayClock(at: string | Date, now: number | null): string {
	const when = new Date(at);
	const clock = formatClock(when);
	if (now === null) return clock;
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const t = when.getTime();
	if (t >= start.getTime()) return `Today ${clock}`;
	if (t >= start.getTime() - DAY) return `Yesterday ${clock}`;
	return `${formatDate(when)} ${clock}`;
}

/** Who started a run, for `Started … by <who>` (#811), from its `triggerType` entry. */
export function startedBy(triggerType: string | null | undefined): string {
	return startedByUser(triggerType) ? "you" : "PrismaLens";
}

/** Why PrismaLens started it, under that line; nothing for a run you started. */
export const startedWhy = triggerWhy;

/** `machine git (gh)` from `machine git (gh, sumit)`: the chip names the helper, the tooltip the user. */
export function shortCredential(c: RunCredential): string {
	if (c.source !== "machine") return c.label;
	return c.label.replace(/\(([^,)]+),[^)]*\)/, "($1)");
}

/**
 * The run strip's credential chip (operator ruling, #811): `Code: machine
 * git (gh)`, `Code: token <label>`, `Code: public`; the full source and fingerprint on hover.
 */
export function codeChip(
	workspace:
		| { repos: { name: string; credential?: RunCredential }[] }
		| null
		| undefined,
): { text: string; title: string; warn?: boolean } | null {
	const repos = (workspace?.repos ?? []).flatMap((r) =>
		r.credential ? [{ name: r.name, credential: r.credential }] : [],
	);
	if (repos.length === 0) return null;
	const short = Array.from(
		new Set(repos.map((r) => shortCredential(r.credential))),
	);
	const title = repos
		.map((r) => {
			const c = r.credential;
			const line = `Cloned with ${c.label}, via ${c.via}${c.fallback ? ". Your machine's git was refused, so a saved token was used" : ""}${c.fallbackFrom ? ". Fell back" : ""}`;
			return repos.length > 1 ? `${r.name}: ${line}` : line;
		})
		.join("; ");
	const fell = repos.some((r) => r.credential.fallbackFrom);
	return {
		text: `Code: ${short.join(", ")}${fell ? ", fell back" : ""}`,
		title,
		...(fell ? { warn: true } : {}),
	};
}

/** The header's firing word: `Firing for 12h 48m`, `Not firing`, or nothing without alerts. */
export function firingWord(
	all: readonly {
		status: string;
		triggeredAt?: string | Date | null;
		source?: string | null;
	}[],
	now: number | null,
): { text: string; firing: boolean } | null {
	const alerts = all.filter((a) => !isEvent(a));
	if (alerts.length === 0) return null;
	const firing = alerts.filter((a) => isAlertFiring(a.status));
	if (firing.length === 0) return { text: "Not firing", firing: false };
	const since = Math.min(
		...firing.map((a) =>
			a.triggeredAt ? new Date(a.triggeredAt).getTime() : Number.NaN,
		),
	);
	if (now === null || Number.isNaN(since))
		return { text: "Firing", firing: true };
	return {
		text: `Firing for ${formatElapsed((now - since) / 1000)}`,
		firing: true,
	};
}

/** The header's Retry, unless a provider stop's dock already offers Try again. */
export function stripRetry(retryable: boolean, stop: unknown): boolean {
	return retryable && !stop;
}
