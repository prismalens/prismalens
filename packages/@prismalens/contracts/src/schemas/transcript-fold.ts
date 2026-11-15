// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "./investigation.js";
import { plTool } from "./tools.js";

/**
 * What folds depends on what the content is for (#1101 category 12 item 6):
 * `read` never folds (answers, asks, notices, stops, reports); `own` is your message,
 * folded past about 6 lines; `thread` is a message from another thread, its sender and
 * 3 lines; `work` folds in levels: turn, then steps, then item, then output.
 */
export const FOLD_CLASSES = ["read", "own", "thread", "work"] as const;
export type FoldClass = (typeof FOLD_CLASSES)[number];

/**
 * Every stored event kind's fold class. A full record, so a new event kind fails
 * typecheck until it is classed. An agent's prose is `work`: the turn's last words,
 * and the last narration before an ask or a stop, are read where the turn is folded.
 */
export const EVENT_FOLD: { readonly [K in CanonicalEvent["kind"]]: FoldClass } =
	{
		agent_step: "work",
		tool_result: "work",
		branch_done: "read",
		error: "read",
		operator_message: "own",
		message_queued: "own",
		message_edited: "own",
		message_withdrawn: "own",
		ask_opened: "read",
		ask_closed: "read",
		session_config: "work",
		harness_tool_call: "work",
		harness_tools: "work",
		// The starter's link to the thread it started stays read: bar 10.2 (#1101).
		thread_started: "read",
		thread_message: "thread",
		threads_stopped: "read",
		action_proposed: "read",
		action_resolved: "read",
		artifact_published: "read",
		finding_recorded: "work",
		permission_ask: "read",
		subagent: "work",
		permission_answer: "read",
		compaction: "read",
		usage_limit: "read",
		provider_blocked: "read",
		provider_retry: "read",
		message_inbound: "thread",
		run_interrupted: "read",
		agent_quota: "read",
		agent_drift: "read",
		turn_usage: "work",
		wake_scheduled: "work",
		pr_watch: "work",
		resume_scheduled: "read",
		resumed: "read",
		plan: "work",
		thought: "work",
		pr_status: "read",
		jobs_ended: "read",
		auto_paused: "read",
		pull_request_linked: "read",
		report: "read",
	};

/** An event's fold class; a delivered message from another thread is `thread`, an outcome `read`. */
export function eventFold(e: CanonicalEvent): FoldClass {
	if (e.kind === "operator_message") {
		const env = deliveryEnvelope(e.text);
		if (env?.from === "thread") return "thread";
		if (env?.from === "outcome") return "read";
	}
	return EVENT_FOLD[e.kind];
}

/** What became of an agent's call that waited on your approval. */
export const OUTCOME_VERDICTS = [
	"approved",
	"denied",
	"failed",
	"expired",
] as const;
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

/** A message PrismaLens wrapped for the agent, read back as who sent it and its words. */
export type DeliveryEnvelope =
	| { from: "thread"; name: string; link: string | null; text: string }
	| {
			from: "outcome";
			tool: string;
			requestId: string;
			verdict: OutcomeVerdict;
			/** The plain words: "Started a thread", "You denied: Start a thread". */
			title: string;
			/** What it said after the verdict: the result, the reason, the failure. */
			text: string;
	  };

const THREAD_ENVELOPE = /^\[Message from (.+?)(?: \((\/[^)\s]+)\))?\]\s*/;
const OUTCOME_ENVELOPE =
	/^\[PrismaLens\] Your (\S+) call \(requestId "([^"]*)"\) was (approved but did not run|approved|denied by the user|\w+ before the user answered)[:.]?\s*/;

/**
 * The envelope a delivery came in, or null for a message you wrote. Parsed whole,
 * before any preview cuts it, so no reader ever sees `[Message from …` (#1101 cat 14).
 */
export function deliveryEnvelope(text: string): DeliveryEnvelope | null {
	const t = THREAD_ENVELOPE.exec(text);
	if (t)
		return {
			from: "thread",
			name: t[1] as string,
			link: t[2] ?? null,
			text: text.slice(t[0].length),
		};
	const o = OUTCOME_ENVELOPE.exec(text);
	if (!o) return null;
	const tool = o[1] as string;
	const said = o[3] as string;
	const verdict: OutcomeVerdict = said.startsWith("approved but")
		? "failed"
		: said === "approved"
			? "approved"
			: said.startsWith("denied")
				? "denied"
				: "expired";
	const label = plTool(tool)?.label;
	const ask = label?.ask ?? tool;
	const title =
		verdict === "approved"
			? (label?.step ?? `${ask}: approved`)
			: verdict === "denied"
				? `You denied: ${ask}`
				: verdict === "failed"
					? `${ask}: approved, but it did not run`
					: `${ask}: closed before you answered`;
	return {
		from: "outcome",
		tool,
		requestId: o[2] as string,
		verdict,
		title,
		text: text.slice(o[0].length).trim(),
	};
}
