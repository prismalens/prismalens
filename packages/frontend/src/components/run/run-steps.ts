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
	/** The call's input, for a tool that names no command or path (an MCP tool, #673 w5-41). */
	input: string | null;
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
	const delegated = new Set<string>();
	for (const e of events) {
		if (e.kind === "agent_step") {
			for (const c of e.toolCalls) {
				if (DELEGATE_TOOL.test(c.name)) delegated.add(c.toolCallId);
				if (delegated.has(c.toolCallId)) continue;
				const known = calls.get(c.toolCallId);
				// The call again with the command it opened without (#820): same step, now named.
				if (known) {
					if (Object.keys(c.args).length > 0)
						calls.set(c.toolCallId, { ...known, name: c.name, args: c.args });
					continue;
				}
				calls.set(c.toolCallId, { name: c.name, args: c.args, at: e.ts });
				order.push(c.toolCallId);
			}
		} else if (e.kind === "tool_result") {
			const id = e.result.toolCallId;
			if (delegated.has(id) || DELEGATE_TOOL.test(e.result.name)) continue;
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
			input: inputOf(call.args),
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

/** A tool's arguments as indented JSON when they name no command or path. */
function inputOf(args: Record<string, unknown>): string | null {
	if (Object.keys(args).length === 0) return null;
	const command = args.command ?? args.cmd;
	const path = args.path ?? args.filePath ?? args.file_path;
	if (typeof command === "string" || Array.isArray(command)) return null;
	if (typeof path === "string") return null;
	try {
		return JSON.stringify(args, null, 2).slice(0, 2000);
	} catch {
		return null;
	}
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

const cite = (s: string) =>
	s
		.toLowerCase()
		.replace(/[`'"“”]/g, "")
		.replace(/\brepo\//g, "")
		.replace(/\s+/g, " ")
		.trim();

/** A file (`config.py`) or a slashed path (`/api/v1/rules`) a source names. */
const PATH =
	/[\w.-]+(?:\/[\w.-]+)*\.[a-z][a-z0-9]{0,5}\b|\/?[\w.-]+(?:\/[\w.-]+){2,}/g;
/** Below this, a shared run of characters is chance, not the same command. */
const SHARED_MIN = 24;

function shared(a: string, b: string): number {
	let best = 0;
	const prev = new Array<number>(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i++) {
		let diag = 0;
		for (let j = 1; j <= b.length; j++) {
			const up = prev[j] ?? 0;
			prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
			best = Math.max(best, prev[j] ?? 0);
			diag = up;
		}
	}
	return best;
}

/**
 * The step an evidence item came from (#673 w5-16): its own call id, else the
 * step whose command or file its `source` names. The agent cannot see call ids,
 * so most items arrive with none.
 */
export function evidenceStep(
	e: { toolCallId?: string | null; source: string },
	steps: readonly RunStep[],
): number | undefined {
	const own = e.toolCallId
		? steps.find((s) => s.callId === e.toolCallId)
		: undefined;
	if (own) return own.n;
	const src = cite(e.source);
	const paths = src.match(PATH) ?? [];
	// `api/config.py:28 (git show 097fc82)`: each clause can name a command on its own.
	const clauses = src
		.split(/[;,()]| and /)
		.map((c) => c.trim())
		.filter((c) => c.length >= 10 && c.includes(" "));
	let best: { n: number; score: number } | undefined;
	for (const s of steps) {
		if (s.ok === false) continue;
		const cmd = cite(s.command);
		let score = 0;
		if (cmd.length >= 4 && src.includes(cmd)) score = cmd.length + 3000;
		else if (src.length >= 8 && cmd.includes(src)) score = src.length + 3000;
		for (const c of clauses)
			if (cmd.includes(c)) score = Math.max(score, c.length + 2000);
		for (const p of paths)
			if (cmd.includes(p)) score = Math.max(score, p.length + 1000);
		if (!score) {
			const run = shared(src, cmd);
			if (run >= SHARED_MIN) score = run;
		}
		if (score > (best?.score ?? 0)) best = { n: s.n, score };
	}
	return best?.n;
}
