// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens's own tool rows (#1101 cat 9): a past-tense label that names its subject,
 * the arguments as one plain line, and the PrismaLens half of a turn's summary.
 */
import { HARNESS_TOOL_STEPS, plToolName } from "@prismalens/contracts";

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

/** [running, done] words and the subject they take, per tool; the rest use HARNESS_TOOL_STEPS. */
const LABELS: Record<
	string,
	{ running: string; done: string; subject?: (i: Input) => string | null }
> = {
	pl_thread_start: {
		running: "Starting thread",
		done: "Started thread",
		subject: (i) => quoted(str(i.title)),
	},
	pl_thread_send: {
		running: "Messaging",
		done: "Messaged",
		subject: (i) => str(i.to),
	},
	pl_thread_wait: {
		running: "Waiting on",
		done: "Waited on",
		subject: (i) =>
			Array.isArray(i.ids)
				? i.ids.length === 1
					? str(i.ids[0])
					: `${i.ids.length} threads`
				: null,
	},
	pl_thread_cancel: {
		running: "Stopping",
		done: "Stopped",
		subject: (i) => str(i.id),
	},
	pl_thread_read: {
		running: "Reading thread",
		done: "Read thread",
		subject: (i) => str(i.threadId),
	},
	pl_thread_title: {
		running: "Naming this thread",
		done: "Named this thread",
		subject: (i) => quoted(str(i.title)),
	},
	pl_pr_watch: {
		running: "Starting to watch",
		done: "Watching",
		subject: prSubject,
	},
	pl_pr_unwatch: {
		running: "Stopping the watch on",
		done: "Stopped watching",
		subject: prSubject,
	},
	pl_pr_link: { running: "Linking", done: "Linked", subject: prSubject },
	pl_ask_user: {
		running: "Asking you",
		done: "Asked you",
		subject: (i) => {
			const qs = Array.isArray(i.questions) ? (i.questions as Input[]) : [];
			const first = quoted(str(qs[0]?.question));
			return qs.length > 1 ? `${first} and ${qs.length - 1} more` : first;
		},
	},
	pl_secret_request: {
		running: "Asking you for",
		done: "Asked you for",
		subject: (i) => str(i.name),
	},
	pl_wakeup_schedule: {
		running: "Scheduling a wake",
		done: "Scheduled a wake",
		subject: (i) =>
			typeof i.delaySeconds === "number"
				? `in ${Math.round(i.delaySeconds / 60)} min`
				: null,
	},
	pl_artifact_publish: {
		running: "Publishing",
		done: "Published",
		subject: (i) => quoted(str(i.title)),
	},
	pl_runbooks_read: {
		running: "Reading runbook",
		done: "Read runbook",
		subject: (i) => str(i.path),
	},
	pl_service_get: {
		running: "Reading service",
		done: "Read service",
		subject: (i) => str(i.name),
	},
	pl_evidence_record: {
		running: "Recording evidence",
		done: "Recorded evidence",
		subject: (i) => quoted(str(i.observation)),
	},
	pl_hypothesis_record: {
		running: "Recording a hypothesis",
		done: "Recorded hypothesis",
		subject: (i) => quoted(str(i.statement)),
	},
	pl_attachment_read: {
		running: "Reading attachment",
		done: "Read attachment",
		subject: (i) => str(i.id),
	},
	pl_cron_create: {
		running: "Scheduling",
		done: "Scheduled",
		subject: (i) => quoted(str(i.prompt, 40)),
	},
};

const asInput = (input: unknown): Input =>
	input && typeof input === "object" && !Array.isArray(input)
		? (input as Input)
		: {};

/** "Watching PR #1088", "Started thread “Check the DB”"; a tool with no subject reads as its step title. */
export function plLabel(name: string, input: unknown, state: PlState): string {
	const tool = plToolName(name);
	const l = LABELS[tool];
	const plain = HARNESS_TOOL_STEPS[tool] ?? tool;
	if (!l) return state === "running" ? `${plain}, still running` : plain;
	const subject = l.subject?.(asInput(input));
	const verb = state === "running" ? l.running : l.done;
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

/** How each PrismaLens tool counts in a turn's summary. */
const BUCKET: Record<string, [one: string, many: string, verb: string]> = {
	pl_thread_start: ["thread", "threads", "started"],
	pl_thread_send: ["message", "messages", "sent"],
	pl_pr_watch: ["PR", "PRs", "watched"],
	pl_pr_link: ["PR", "PRs", "linked"],
	pl_ask_user: ["question", "questions", "asked"],
	pl_secret_request: ["secret", "secrets", "asked for"],
	pl_evidence_record: ["evidence", "evidence", "recorded"],
	pl_hypothesis_record: ["hypothesis", "hypotheses", "recorded"],
	pl_artifact_publish: ["page", "pages", "published"],
	pl_wakeup_schedule: ["wake", "wakes", "scheduled"],
	pl_cron_create: ["prompt", "prompts", "scheduled"],
};

/** `started 2 threads, watched 1 PR, 3 lookups`: the PrismaLens half of a turn's summary. */
export function plSummary(names: readonly string[]): string {
	const counts = new Map<string, number>();
	let lookups = 0;
	for (const n of names) {
		const tool = plToolName(n);
		if (BUCKET[tool]) counts.set(tool, (counts.get(tool) ?? 0) + 1);
		else lookups++;
	}
	const parts: string[] = [];
	for (const [tool, n] of Array.from(counts)) {
		const [one, many, verb] = BUCKET[tool] as [string, string, string];
		parts.push(`${verb} ${n} ${n === 1 ? one : many}`);
	}
	if (lookups) parts.push(`${lookups} ${lookups === 1 ? "lookup" : "lookups"}`);
	return parts.join(", ");
}
