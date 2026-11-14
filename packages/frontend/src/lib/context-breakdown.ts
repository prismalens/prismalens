// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What fills the context window (#1101 cat 11), estimated from the thread's own record.
 * The agent reports only the total, so each category is PrismaLens's estimate and the
 * rest is the agent's own setup; nothing an agent did not report is shown as zero.
 */
import { type CanonicalEvent, plToolName } from "@prismalens/contracts";

/** About four characters a token, for text the record holds. */
const CHARS_PER_TOKEN = 4;
/** An image costs about this many tokens whatever its bytes. */
const IMAGE_TOKENS = 1_600;
const LARGEST = 5;

export type ContextCategory =
	| "brief"
	| "messages"
	| "attachments"
	| "pl_tools"
	| "tools"
	| "replies"
	| "summary"
	| "agent";

export const CATEGORY_LABEL: Record<ContextCategory, string> = {
	brief: "Brief and alert",
	messages: "Your messages",
	attachments: "Attachments",
	pl_tools: "PrismaLens tools",
	tools: "Other tool results",
	replies: "Agent replies",
	summary: "Compacted summary",
	agent: "Agent's setup and history",
};

export interface ContextRow {
	category: ContextCategory;
	tokens: number;
	percent: number;
}

export interface ContextItem {
	label: string;
	category: ContextCategory;
	tokens: number;
}

export interface ContextBreakdown {
	used: number;
	size: number;
	rows: ContextRow[];
	free: number;
	largest: ContextItem[];
	/** The cheapest trim, when one item alone is a large share. */
	trim: string | null;
}

const tokens = (text: string | undefined | null) =>
	text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;

const short = (s: string, n = 48) =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** A tool's source without its JSON arguments: "`kubectl logs x`({…})" reads `kubectl logs x`. */
function toolLabel(source: string): string {
	const head = source.split(/\(\{|\s\{"/)[0] ?? source;
	return short(head.replaceAll("`", "").trim() || source, 40);
}

/** The window's contents by category, from the events since the last compaction. */
export function contextBreakdown(
	events: readonly CanonicalEvent[],
	usage: { used: number; size: number },
): ContextBreakdown {
	let since = 0;
	let summary = 0;
	events.forEach((e, i) => {
		if (e.kind === "compaction" && e.phase === "completed") {
			since = i + 1;
			summary = e.after ?? 0;
		}
	});
	const sums = new Map<ContextCategory, number>();
	const items: ContextItem[] = [];
	const add = (category: ContextCategory, n: number, label?: string) => {
		if (n <= 0) return;
		sums.set(category, (sums.get(category) ?? 0) + n);
		if (label) items.push({ label, category, tokens: n });
	};
	if (summary) add("summary", summary);
	let briefSeen = false;
	for (const e of events.slice(since)) {
		switch (e.kind) {
			case "operator_message": {
				const first = !briefSeen;
				briefSeen = true;
				add(
					first ? "brief" : "messages",
					tokens(e.text),
					first ? "The brief" : `Message “${short(e.text, 32)}”`,
				);
				for (const a of e.attachments ?? [])
					add(
						"attachments",
						a.mimeType.startsWith("image/")
							? IMAGE_TOKENS
							: Math.ceil(a.size / CHARS_PER_TOKEN),
						a.name,
					);
				break;
			}
			case "harness_tool_call":
				add(
					"pl_tools",
					tokens(e.output) + tokens(JSON.stringify(e.input ?? "")),
					plToolName(e.name),
				);
				break;
			case "tool_result":
				add("tools", tokens(e.result.preview), toolLabel(e.result.source));
				break;
			case "agent_step":
				add("replies", tokens(e.text));
				break;
		}
	}
	const known = Array.from(sums.values()).reduce((a, b) => a + b, 0);
	// The agent's system prompt, tools and memory are the part its total holds beyond ours.
	if (usage.used > known) sums.set("agent", usage.used - known);
	const total = Math.max(usage.used, known);
	const pct = (n: number) =>
		usage.size > 0 ? Math.round((n / usage.size) * 1000) / 10 : 0;
	const rows = (Object.keys(CATEGORY_LABEL) as ContextCategory[])
		.filter((c) => (sums.get(c) ?? 0) > 0)
		.map((category) => ({
			category,
			tokens: sums.get(category) ?? 0,
			percent: pct(sums.get(category) ?? 0),
		}));
	const largest = items.sort((a, b) => b.tokens - a.tokens).slice(0, LARGEST);
	const top = largest[0];
	return {
		used: usage.used,
		size: usage.size,
		rows,
		free: Math.max(0, usage.size - total),
		largest,
		trim:
			top && usage.size > 0 && top.tokens / usage.size >= 0.1
				? `Compacting with “drop ${short(top.label, 32)}” frees the most`
				: null,
	};
}
