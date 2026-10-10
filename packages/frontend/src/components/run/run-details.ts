// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	Evidence,
	InvestigationReport,
	InvestigationWithRelations,
} from "@prismalens/contracts";
import type { OperatorState, TranscriptItem } from "@/lib/investigation-events";
import { commandText } from "@/lib/report-view";
import { shortCredential } from "./run-labels";
import type { RunStep } from "./run-steps";

export type DetailTone = "ok" | "live" | "warn" | "danger";

/** Where a row's link leaves for; a step jump stays on the page. */
export type DetailLink =
	| { kind: "overview" }
	| { kind: "run"; id: string }
	| { kind: "settings"; section: "agent" | "integrations" };

export interface DetailRow {
	label?: string;
	text: string;
	sub?: string;
	tone?: DetailTone;
	mono?: boolean;
	strong?: boolean;
	/** A flagged item sits on the danger tint. */
	box?: "danger";
	/** In-page: opens and highlights step N in the transcript. */
	step?: number;
	/** Navigates away, named by `action` or by the row's own text. */
	link?: DetailLink;
	action?: string;
}

export interface DetailSection {
	title: string;
	rows: DetailRow[];
}

/** What the Summary reads that the run row does not carry: names the page resolved. */
export interface SummaryFacts {
	status: { text: string; tone?: DetailTone; sub?: string };
	started: { text: string; sub?: string };
	took: { label: "Took" | "Running for"; text: string } | null;
	agent: string | null;
	model: { text: string; sub?: string; warn: boolean } | null;
	effort: string | null;
	access: { text: string; sub: string } | null;
	chat: boolean;
}

/** Summary (#811 data mapping): status, who started it, time, can continue, what it used, its code. */
export function summarySections(
	inv: InvestigationWithRelations,
	facts: SummaryFacts,
): DetailSection[] {
	const run: DetailRow[] = [
		{
			label: "Status",
			text: facts.status.text,
			tone: facts.status.tone,
			sub: facts.status.sub,
		},
		{
			label: facts.chat ? "Asked" : "Started",
			text: facts.started.text,
			sub: facts.started.sub,
		},
	];
	if (facts.took) run.push({ label: facts.took.label, text: facts.took.text });
	if (!facts.chat && inv.status !== "running" && inv.status !== "pending") {
		const can = !!inv.resumable || !!inv.continuable;
		run.push({
			label: "Can continue",
			text: can ? "Yes" : "No",
			sub: can
				? inv.continuable
					? "The agent session was kept. Continuing takes this run on to its report."
					: "The agent session was kept. Continuing resumes it."
				: (inv.resumeBlockedReason ?? "The agent kept no session to resume."),
		});
	}
	const used: DetailRow[] = [];
	if (facts.agent) used.push({ label: "Agent", text: facts.agent });
	if (facts.model)
		used.push({
			label: "Model",
			text: facts.model.text,
			tone: facts.model.warn ? "warn" : undefined,
			sub: facts.model.sub,
		});
	if (facts.effort) used.push({ label: "Effort", text: facts.effort });
	if (facts.access)
		used.push({
			label: "Access",
			text: facts.access.text,
			sub: facts.access.sub,
			link: { kind: "settings", section: "agent" },
			action: "Settings",
		});
	const sections: DetailSection[] = [
		{ title: facts.chat ? "Question" : "Run", rows: run },
	];
	if (used.length)
		sections.push({
			title: facts.chat ? "What this answer used" : "What this run used",
			rows: used,
		});
	const code = codeRows(inv);
	if (code.length) sections.push({ title: "Code", rows: code });
	return sections;
}

function codeRows(inv: InvestigationWithRelations): DetailRow[] {
	return (inv.workspace?.repos ?? []).map((r) => {
		const c = r.credential;
		const how = c
			? c.source === "none"
				? `Cloned without a credential (${shortCredential(c)}) from ${r.url}.`
				: `Cloned with ${c.label} from ${r.url}.`
			: `From ${r.url}.`;
		const maps = r.services.length ? ` Maps to ${r.services.join(", ")}.` : "";
		return {
			label: r.name,
			text: `${r.branch ?? "HEAD"} at ${r.head.slice(0, 7)}`,
			mono: true,
			sub: `${how}${maps}`,
		};
	});
}

function evidenceRow(e: Evidence, steps: Map<string, number>): DetailRow {
	const step = e.toolCallId ? steps.get(e.toolCallId) : undefined;
	return {
		text: e.observation,
		sub:
			e.status === "inferred"
				? `Inferred from ${e.source}`
				: commandText(e.source),
		...(step ? { step } : {}),
	};
}

/**
 * Evidence (#811 data mapping): the likely cause with each item's step
 * (`evidence.toolCallId`), ruled out, checked, not checked, next steps.
 * A live run, a failed run and a run with no report each say so instead.
 */
export function evidenceSections(
	inv: InvestigationWithRelations,
	steps: Map<string, number>,
	opts: { live: boolean; standing: { runId: string; name: string } | null },
): DetailSection[] {
	const report = inv.report;
	if (!report) {
		const text = opts.live
			? "No conclusion yet."
			: inv.status === "failed"
				? "The run failed before it reported."
				: inv.kind === "chat"
					? "A question ends in an answer, not a report."
					: "The run ended before it reported.";
		const rows: DetailRow[] = [{ text }];
		if (opts.standing && inv.kind !== "chat")
			rows.push({
				text: `${opts.standing.name}'s finding stands${opts.live ? " until this run reports" : ""}.`,
				link: { kind: "run", id: opts.standing.runId },
				action: `Open ${opts.standing.name}`,
			});
		return [{ title: opts.live ? "So far" : "No report", rows }];
	}
	return reportSections(report, steps);
}

function reportSections(
	report: InvestigationReport,
	steps: Map<string, number>,
): DetailSection[] {
	const out: DetailSection[] = [];
	const [top, ...others] = report.hypotheses.filter(
		(h) => h.status !== "refuted",
	);
	if (top)
		out.push({
			title: "Likely cause",
			rows: [
				{ text: report.rootCause ?? top.statement, strong: true },
				...top.evidence
					.filter((e) => e.direction === "supports")
					.map((e) => evidenceRow(e, steps)),
			],
		});
	else
		out.push({
			title: "Likely cause",
			rows: [{ text: "This run named no cause.", sub: report.summary }],
		});
	if (others.length)
		out.push({
			title: "Also possible",
			rows: others.map((h) => {
				const first = h.evidence[0];
				const step = first?.toolCallId
					? steps.get(first.toolCallId)
					: undefined;
				return { text: h.statement, ...(step ? { step } : {}) };
			}),
		});
	const ruled: DetailRow[] = [
		...report.ruledOut.map((r) => {
			const call = r.evidence.find((e) => e.toolCallId)?.toolCallId;
			const step = call ? steps.get(call) : undefined;
			return { text: r.statement, sub: r.why, ...(step ? { step } : {}) };
		}),
		...report.hypotheses
			.filter((h) => h.status === "refuted")
			.map((h) => {
				const against = h.evidence.find((e) => e.direction === "contradicts");
				const step = against?.toolCallId
					? steps.get(against.toolCallId)
					: undefined;
				return {
					text: h.statement,
					...(against ? { sub: against.observation } : {}),
					...(step ? { step } : {}),
				};
			}),
	];
	if (ruled.length) out.push({ title: "Ruled out", rows: ruled });
	if (report.coverage.queried.length)
		out.push({
			title: "Checked",
			rows: [{ text: report.coverage.queried.join(", ") }],
		});
	if (report.coverage.notQueried.length)
		out.push({
			title: "Not checked",
			rows: [
				...report.coverage.notQueried.map((text) => ({ text })),
				{
					text: "A source the agent could not reach can be connected in Settings.",
					link: { kind: "settings", section: "integrations" },
					action: "Connect a source",
				},
			],
		});
	if (report.nextSteps.length)
		out.push({
			title: "Agent's suggested next steps",
			rows: report.nextSteps.map((s, i) => ({
				text: s.title,
				sub: s.detail,
				...(i === 0
					? { link: { kind: "overview" } as const, action: "Stop the impact" }
					: {}),
			})),
		});
	return out;
}

const WHERE: Record<"context-pack" | "tool-output", string> = {
	"tool-output": "A command's output tried to give the agent an instruction",
	"context-pack": "What PrismaLens gave the agent held an instruction",
};

const DELIVERY: Partial<Record<OperatorState, string>> = {
	queued: "Waiting for the agent's next pause",
	delivered: "Read by the agent at its next pause",
	sent_now: "Sent now",
	answered: "Answered",
	not_delivered: "The run ended before it reached the agent",
	resumed: "Continued the run",
	asked: "Asked",
};

/**
 * Context (#811 data mapping): flagged content first, the brief, your
 * messages with their delivery, and the alert the incident came from.
 */
export function contextSections(input: {
	report: InvestigationReport | null | undefined;
	flaggedStep: Map<number, number>;
	items: TranscriptItem[];
	briefBy: string;
	alert: {
		title: string;
		labels: Record<string, string> | null;
		fired: string;
	} | null;
}): DetailSection[] {
	const out: DetailSection[] = [];
	const flagged = input.report?.flaggedContent ?? [];
	if (flagged.length)
		out.push({
			title: "Flagged",
			rows: flagged.map((f, i) => {
				const step = input.flaggedStep.get(i);
				return {
					text: WHERE[f.where],
					box: "danger" as const,
					strong: true,
					sub: `It read: "${f.quote}". ${f.why}`,
					...(step ? { step } : {}),
				};
			}),
		});
	const operators = input.items.filter(
		(i): i is Extract<TranscriptItem, { kind: "operator" }> =>
			i.kind === "operator",
	);
	const [brief, ...later] = operators;
	if (brief && brief.state === "started")
		out.push({
			title: "Brief",
			rows: [{ text: brief.text, sub: `Written by ${input.briefBy}` }],
		});
	const mine = brief && brief.state === "started" ? later : operators;
	if (mine.length)
		out.push({
			title: "Your messages",
			rows: mine.map((m) => ({
				text: m.text || "A file",
				sub: DELIVERY[m.state] ?? "",
			})),
		});
	if (input.alert) {
		const rows: DetailRow[] = [{ label: "Name", text: input.alert.title }];
		const labels = Object.entries(input.alert.labels ?? {});
		if (labels.length)
			rows.push({
				label: "Labels",
				text: labels.map(([k, v]) => `${k}=${v}`).join(" "),
				mono: true,
			});
		rows.push({ label: "Fired", text: input.alert.fired });
		out.push({ title: "Alert", rows });
	}
	return out;
}

/** The Steps tab's filters (#811). */
export type StepFilter = "all" | "command" | "file" | "failed";

export function filterSteps(steps: RunStep[], filter: StepFilter): RunStep[] {
	if (filter === "all") return steps;
	if (filter === "failed") return steps.filter((s) => s.ok === false);
	return steps.filter((s) => s.kind === filter);
}
