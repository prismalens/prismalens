// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	type Evidence,
	type InvestigationReport,
	isAlertFiring,
} from "@prismalens/contracts";
import { answerWord } from "./answer-word";
import { formatClock } from "./format-time";
import { fileVerb } from "./investigation-events";
import { refusalReason } from "./refusal-sentence";

/** The report's facts as pure data (study-v3 §3.2); the Report tab only lays them out. */

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

export interface NowLine {
	text: string;
	firing: boolean;
}

/** Whether it is still broken, from the alerts the incident carries (finding 5). */
export function nowLine(
	alerts: { status: string; triggeredAt: string; resolvedAt?: string | null }[],
	service: string | null,
): NowLine | null {
	if (alerts.length === 0) return null;
	const on = service ? ` on ${service}` : "";
	const firing = alerts.filter((a) => isAlertFiring(a.status));
	if (firing.length > 0) {
		const since = Math.min(...firing.map((a) => Date.parse(a.triggeredAt)));
		const what = firing.length === 1 ? "1 alert" : `${firing.length} alerts`;
		return {
			text: `${what} still firing since ${formatClock(since)}${on}`,
			firing: true,
		};
	}
	const cleared = alerts
		.map((a) => (a.resolvedAt ? Date.parse(a.resolvedAt) : 0))
		.reduce((a, b) => Math.max(a, b), 0);
	const word = alerts.length === 1 ? "Alert" : "Alerts";
	return {
		text: cleared
			? `${word} cleared at ${formatClock(cleared)}; nothing firing${on} now`
			: `Nothing firing${on} now`,
		firing: false,
	};
}

/** The agent's own words, without the engine's "harness exited early (…):" wrapper. */
export function harnessWords(error: string): string {
	return error.replace(/^harness exited early \([^)]*\):\s*/i, "").trim();
}

/** `For, seen`: which way a line of evidence points and whether a tool showed it. */
export function evidenceLabel(e: Pick<Evidence, "direction" | "status">) {
	return `${e.direction === "supports" ? "For" : "Against"}, ${e.status === "verified" ? "seen" : "inferred"}`;
}

/** A path inside the run's copy reads as `repo/…`, never the run's workspace path (walk f16). */
export function shortPath(text: string, cwd: string | null | undefined) {
	if (!cwd) return text;
	const base = cwd.replace(/[/\\]+$/, "");
	return text.split(`${base}/`).join("repo/").split(base).join("repo");
}

/**
 * What ran, as a command or a path, from the engine's `name(args)` source
 * (acp-adapter.ts deriveSource): `git show e87ad72`, `read api/books.py`.
 */
export function commandText(source: string, cwd?: string | null): string {
	const m = /^(.*?)\((\{[\s\S]*\})\)$/.exec(source.trim());
	const name = (m?.[1] ?? source).replace(/^`(.*)`$/, "$1").trim();
	if (!m?.[2]) return shortPath(name, cwd);
	try {
		const args = JSON.parse(m[2]) as Record<string, unknown>;
		const command = args.command ?? args.cmd;
		if (typeof command === "string" && command.trim())
			return shortPath(command.trim(), cwd);
		const path = args.path ?? args.filePath ?? args.file_path;
		if (typeof path === "string") {
			const verb =
				fileVerb(name) !== "read"
					? fileVerb(name)
					: "new_string" in args || "old_string" in args
						? "edit"
						: "content" in args
							? "write"
							: "read";
			return `${verb} ${shortPath(path, cwd)}`;
		}
	} catch {
		// Not JSON after all: the name is the best there is.
	}
	return shortPath(name, cwd);
}

export interface Refusal {
	source: string;
	reason: string;
	toolCallId: string;
}

/** Calls the gate refused, in the order they were made. */
export function refusalsOf(
	events: readonly CanonicalEvent[],
	cwd?: string | null,
): Refusal[] {
	const out: Refusal[] = [];
	for (const e of events) {
		if (e.kind !== "tool_result" || e.result.ok) continue;
		const reason = refusalReason(e.result.error ?? e.result.preview);
		if (reason)
			out.push({
				source: commandText(e.result.source, cwd),
				reason,
				toolCallId: e.result.toolCallId,
			});
	}
	return out;
}

export type Gap =
	| { kind: "refused"; source: string; reason: string; toolCallId: string }
	| { kind: "not-queried"; source: string };

/** What we could not check: the refusals, then what the run says it did not query. */
export function gapsOf(
	report: Pick<InvestigationReport, "coverage">,
	events: readonly CanonicalEvent[],
	cwd?: string | null,
): Gap[] {
	return [
		...refusalsOf(events, cwd).map((r) => ({ kind: "refused" as const, ...r })),
		...report.coverage.notQueried.map((source) => ({
			kind: "not-queried" as const,
			source,
		})),
	];
}

/** Every source the answer stands on, once each, one per line. */
export function groundedIn(
	report: Pick<InvestigationReport, "coverage" | "hypotheses" | "ruledOut">,
	cwd?: string | null,
): string[] {
	const all = [
		...report.coverage.queried,
		...report.hypotheses.flatMap((h) => h.evidence.map((e) => e.source)),
		...report.ruledOut.flatMap((r) => r.evidence.map((e) => e.source)),
	].map((s) => shortPath(s.trim(), cwd));
	return Array.from(new Set(all.filter(Boolean)));
}

/** How far a run got: commands run and files read, from its tool results. */
export function workDone(events: readonly CanonicalEvent[]) {
	let commands = 0;
	let files = 0;
	for (const e of events) {
		if (e.kind !== "tool_result") continue;
		if (e.result.toolCategory === "file") files++;
		else commands++;
	}
	return { commands, files };
}

/** `ran 8 commands and read 3 files`. */
export function workSentence(w: { commands: number; files: number }) {
	const parts = [
		w.commands ? `ran ${plural(w.commands, "command")}` : null,
		w.files ? `read ${plural(w.files, "file")}` : null,
	].filter(Boolean);
	return parts.length ? parts.join(" and ") : "ran nothing";
}

export interface FixBriefInput {
	incident: { number: number; title: string };
	report: InvestigationReport;
	steps: { title: string; detail?: string | null; done: boolean }[];
	cwd?: string | null;
}

/**
 * The hand-off to the operator's own coding agent (study-v3 §3.2): the cause,
 * the commit, the evidence sources and the steps still open, as plain text.
 */
export function fixBrief({ incident, report, steps, cwd }: FixBriefInput) {
	const { word } = answerWord(report);
	const lines = [`INC-${incident.number}: ${incident.title}`, ""];
	lines.push(
		report.rootCause
			? `Cause (${word}): ${report.rootCause}`
			: "Cause: none found",
	);
	const c = report.culprit;
	if (c?.service) lines.push(`Service: ${c.service}`);
	if (c?.changeRef) lines.push(`Commit: ${c.changeRef}`);
	if (c?.mechanism) lines.push(`Mechanism: ${c.mechanism}`);
	const top = report.hypotheses.find((h) => h.status !== "refuted");
	if (top && top.evidence.length > 0) {
		lines.push("", "Evidence:");
		for (const e of top.evidence)
			lines.push(
				`- ${e.observation} (${evidenceLabel(e)}; ${shortPath(e.source, cwd)})`,
			);
	}
	const open = steps.filter((s) => !s.done);
	if (open.length > 0) {
		lines.push("", "Open steps:");
		open.forEach((s, i) => {
			lines.push(`${i + 1}. ${s.title}${s.detail ? `: ${s.detail}` : ""}`);
		});
	}
	return `${lines.join("\n")}\n`;
}

/** Items in the report's next-step order; a title the report does not list goes last. */
export function inReportOrder<T extends { title: string }>(
	items: readonly T[],
	nextSteps: readonly { title: string }[],
): T[] {
	const order = nextSteps.map((s) => s.title);
	const rank = (t: string) => {
		const i = order.indexOf(t);
		return i < 0 ? Number.POSITIVE_INFINITY : i;
	};
	return [...items].sort((a, b) => rank(a.title) - rank(b.title));
}
