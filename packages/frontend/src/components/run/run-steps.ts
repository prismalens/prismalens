// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	InvestigationReport,
	StreamToolResult,
} from "@prismalens/contracts";
import { fileVerb } from "@/lib/investigation-events";
import { commandText, shortPath } from "@/lib/report-view";

const DELEGATE_TOOL = /^(task|agent|delegate)/i;

export type StepKind = "command" | "file";

/** One numbered tool call (#811): the transcript's step card and the panel's Steps row. */
export interface RunStep {
	n: number;
	callId: string;
	/** What the step was for, when the agent said; else the command itself. */
	title: string;
	/** The command or path, workspace paths read as `repo/`. */
	command: string;
	kind: StepKind;
	verb: string;
	ok: boolean | null;
	/** The turn ended with the call unanswered. */
	unfinished: boolean;
	output: string | null;
	at: string;
	/** Seconds from the call to its result. */
	took: number | null;
}

const FILE_WORD = {
	read: "Read",
	write: "Wrote",
	edit: "Edited",
	delete: "Deleted",
	move: "Moved",
} as const;

function verbOf(
	result: StreamToolResult | null,
	name: string,
	unfinished: boolean,
): string {
	if (!result) return unfinished ? "Not finished" : "Running";
	if (!result.ok) return "Failed";
	if (result.toolCategory === "file") return FILE_WORD[fileVerb(name)];
	if (result.toolCategory === "search") return "Searched";
	return "Ran";
}

/** A tool's output without the Markdown fences the agent wrapped it in. */
export function unfence(text: string): string {
	return text.replace(/```[\w-]*[ \t]*\n|```/g, "").trim();
}

function describe(args: Record<string, unknown>): string | null {
	const d = args.description;
	return typeof d === "string" && d.trim() ? d.trim() : null;
}

/**
 * Every tool call in the order the agent made it, numbered from 1 (#811):
 * `evidence.toolCallId` and `#step-N` resolve through `n`. Delegations are not steps.
 */
export function deriveSteps(
	events: readonly CanonicalEvent[],
	opts: { cwd?: string | null; ended?: boolean } = {},
): RunStep[] {
	const calls = new Map<
		string,
		{ name: string; args: Record<string, unknown>; at: string }
	>();
	const order: string[] = [];
	const results = new Map<string, { result: StreamToolResult; at: string }>();
	for (const e of events) {
		if (e.kind === "agent_step") {
			for (const c of e.toolCalls) {
				if (DELEGATE_TOOL.test(c.name) || calls.has(c.toolCallId)) continue;
				calls.set(c.toolCallId, { name: c.name, args: c.args, at: e.ts });
				order.push(c.toolCallId);
			}
		} else if (e.kind === "tool_result") {
			const id = e.result.toolCallId;
			results.set(id, { result: e.result, at: e.ts });
			if (!calls.has(id)) {
				calls.set(id, { name: e.result.name, args: {}, at: e.ts });
				order.push(id);
			}
		}
	}
	return order.map((callId, i) => {
		const call = calls.get(callId) as {
			name: string;
			args: Record<string, unknown>;
			at: string;
		};
		const done = results.get(callId) ?? null;
		const result = done?.result ?? null;
		const source =
			result?.source ?? `${call.name}(${JSON.stringify(call.args)})`;
		const command = commandText(source, opts.cwd);
		const unfinished = !result && !!opts.ended;
		const output = result
			? unfence(
					result.ok
						? result.preview
						: result.error || result.preview || "no output",
				)
			: null;
		return {
			n: i + 1,
			callId,
			title: describe(call.args) ?? command,
			command,
			kind:
				result?.toolCategory === "file" || result?.toolCategory === "search"
					? "file"
					: "command",
			verb: verbOf(result, call.name, unfinished),
			ok: result ? result.ok : null,
			unfinished,
			output: output ? shortPath(output, opts.cwd) : null,
			at: call.at,
			took: done
				? Math.max(
						0,
						(new Date(done.at).getTime() - new Date(call.at).getTime()) / 1000,
					)
				: null,
		};
	});
}

/** `0.4s`, `12s`, `2m 05s`: a step is usually under a second. */
export function stepTook(seconds: number | null): string {
	if (seconds === null) return "";
	if (seconds < 10) return `${seconds.toFixed(1)}s`;
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const s = Math.round(seconds);
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const squash = (s: string) =>
	s
		.replace(/\s+/g, " ")
		.replace(/^["'“]|["'”…]$/g, "")
		.trim()
		.toLowerCase();

/**
 * The step whose output carried a flagged quote (#207): the report quotes at
 * most 120 characters, so the first 40 of them find the line.
 */
export function flaggedSteps(
	steps: readonly RunStep[],
	flagged: InvestigationReport["flaggedContent"],
): Map<number, number> {
	const out = new Map<number, number>();
	(flagged ?? []).forEach((f, i) => {
		if (f.where !== "tool-output") return;
		const needle = squash(f.quote).slice(0, 40);
		if (!needle) return;
		const hit = steps.find(
			(s) => s.output && squash(s.output).includes(needle),
		);
		if (hit) out.set(i, hit.n);
	});
	return out;
}

/** The step a tool call id is, for evidence links (`evidence.toolCallId`). */
export function stepOfCall(steps: readonly RunStep[]): Map<string, number> {
	return new Map(steps.map((s) => [s.callId, s.n]));
}

/** `#step-4` in the URL, as a step number. */
export function stepFromHash(hash: string): number | null {
	const m = /^#?step-(\d+)$/.exec(hash);
	return m ? Number(m[1]) : null;
}
