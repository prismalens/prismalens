// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens's own tool rows (#1101 cat 9): a past-tense label that names its subject,
 * the arguments as one plain line, and the PrismaLens half of a turn's summary.
 */
import {
	humanizeTool,
	type PlToolName,
	plTool,
	plToolName,
} from "@prismalens/contracts";

export type PlState = "running" | "done" | "failed";

type Input = Record<string, unknown>;

const str = (v: unknown, max = 60): string | null => {
	if (typeof v !== "string" || !v.trim()) return null;
	const t = v.trim().replace(/\s+/g, " ");
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** `#1088` from a PR id or URL; the id as given when it names no number. */
function prSubject(input: Input): string | null {
	const raw = str(input.prId, 200) ?? str(input.url, 200);
	if (!raw) return null;
	const n = raw.match(/(?:pull\/|#|^)(\d+)\/?$/)?.[1];
	return n ? `PR #${n}` : raw;
}

const quoted = (s: string | null) => (s ? `“${s}”` : null);

/** The subject each row names after its verb; the verbs are the registry's (#1125). */
const SUBJECT: Partial<Record<PlToolName, (i: Input) => string | null>> = {
	pl_thread_start: (i) => quoted(str(i.title)),
	pl_thread_send: (i) => str(i.to),
	pl_thread_wait: (i) =>
		Array.isArray(i.ids)
			? i.ids.length === 1
				? str(i.ids[0])
				: `${i.ids.length} threads`
			: null,
	pl_thread_cancel: (i) => str(i.id),
	pl_thread_read: (i) => str(i.threadId),
	pl_thread_title: (i) => quoted(str(i.title)),
	pl_pr_link: prSubject,
	pl_pr_watch: prSubject,
	pl_pr_unwatch: prSubject,
	pl_ask_user: (i) => {
		const qs = Array.isArray(i.questions) ? (i.questions as Input[]) : [];
		const first = quoted(str(qs[0]?.question));
		return qs.length > 1 ? `${first} and ${qs.length - 1} more` : first;
	},
	pl_secret_request: (i) => str(i.name),
	pl_wakeup_schedule: (i) =>
		typeof i.delaySeconds === "number"
			? `in ${Math.round(i.delaySeconds / 60)} min`
			: null,
	pl_artifact_publish: (i) => quoted(str(i.title)),
	pl_runbooks_read: (i) => str(i.path),
	pl_service_get: (i) => str(i.name),
	pl_evidence_record: (i) => quoted(str(i.observation)),
	pl_hypothesis_record: (i) => quoted(str(i.statement)),
	pl_attachment_read: (i) => str(i.id),
	pl_cron_create: (i) => quoted(str(i.prompt, 40)),
};

const asInput = (input: unknown): Input =>
	input && typeof input === "object" && !Array.isArray(input)
		? (input as Input)
		: {};

/** "Watching PR #1088", "Started thread “Check the DB”"; a tool with no subject reads as its step title. */
export function plLabel(name: string, input: unknown, state: PlState): string {
	const label = plTool(name)?.label;
	const plain = label?.step ?? humanizeTool(plToolName(name));
	const verb = state === "running" ? label?.running : label?.done;
	if (!verb) return state === "running" ? `${plain}, still running` : plain;
	const subject = SUBJECT[plToolName(name) as PlToolName]?.(asInput(input));
	if (subject) return `${verb} ${subject}`;
	return state === "running" ? `${verb}, still running` : plain;
}

/** The arguments as one line, `until: merged · role: reviewer`, long text left out. */
export function plArgsLine(input: unknown): string | null {
	const parts = Object.entries(asInput(input))
		.filter(([k, v]) => k !== "requestId" && v !== undefined && v !== null)
		.flatMap(([k, v]) => {
			if (typeof v === "string") return v.length > 80 ? [] : [`${k}: ${v}`];
			if (typeof v === "number" || typeof v === "boolean")
				return [`${k}: ${v}`];
			if (Array.isArray(v)) return [`${k}: ${v.length}`];
			return [];
		});
	return parts.length ? parts.join(" · ") : null;
}

/** `started 2 threads, watched 1 PR, 3 lookups`: the PrismaLens half of a turn's summary. */
export function plSummary(names: readonly string[]): string {
	const counts = new Map<string, number>();
	let lookups = 0;
	for (const n of names) {
		const tool = plTool(n);
		if (tool?.tally) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
		else lookups++;
	}
	const parts: string[] = [];
	for (const [tool, n] of Array.from(counts)) {
		const [one, many, verb] = plTool(tool)?.tally ?? ["", "", ""];
		parts.push(`${verb} ${n} ${n === 1 ? one : many}`);
	}
	if (lookups) parts.push(`${lookups} ${lookups === 1 ? "lookup" : "lookups"}`);
	return parts.join(", ");
}
