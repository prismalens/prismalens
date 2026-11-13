// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The transcript spine's node kinds (#1020), from two mappings: an
 * ordinary tool call by what it names, and a PrismaLens tool by its name, whose
 * recorded output gives the outcome line. Anything else is an honest "tool".
 */
import {
	type CanonicalEvent,
	HARNESS_DATA_NOTE,
	plTool,
	plToolName,
	type ToolKind,
} from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import {
	ChartLine,
	CircleAlert,
	Crosshair,
	FileCheck2,
	FilePen,
	FileText,
	Globe,
	History,
	type LucideIcon,
	PanelsTopLeft,
	Pin,
	SquareTerminal,
	TextSearch,
	Wrench,
} from "lucide-react";
import { formatElapsed } from "./format-time";
import { fileVerb } from "./investigation-events";
import { mcpTool } from "./report-view";

export type NodeKind =
	| "command"
	| "read"
	| "edit"
	| "search"
	| "telemetry"
	| "knowledge"
	| "evidence"
	| "suspect"
	| "artifact"
	| "report"
	| "browse"
	| "failed"
	| "tool";

export const NODE_ICON: Record<NodeKind, LucideIcon> = {
	command: SquareTerminal,
	read: FileText,
	edit: FilePen,
	search: TextSearch,
	telemetry: ChartLine,
	knowledge: History,
	evidence: Pin,
	suspect: Crosshair,
	artifact: PanelsTopLeft,
	report: FileCheck2,
	browse: Globe,
	failed: CircleAlert,
	tool: Wrench,
};

/** A PrismaLens tool's node by its registry kind (#1125); lookups and the rest read as knowledge. */
const KIND_NODE: Record<ToolKind, NodeKind> = {
	lookup: "knowledge",
	search: "knowledge",
	file: "read",
	evidence: "evidence",
	hypothesis: "suspect",
	publish: "artifact",
	report: "report",
	thread: "knowledge",
	ask: "knowledge",
	watch: "knowledge",
	schedule: "knowledge",
	run: "knowledge",
	browse: "browse",
};

/** A PrismaLens tool's node: its record kind, or a knowledge lookup. */
export function gatewayNode(tool: string): NodeKind {
	const kind = plTool(tool)?.kind;
	return kind ? KIND_NODE[kind] : "knowledge";
}

const TELEMETRY_COMMAND =
	/\/api\/v1\/(query|query_range|rules|alerts|series)\b|\/loki\/api\/|\/api\/v2\/alerts\b/;
const TELEMETRY_TOOL = /prometheus|loki|metric|logs?\b|trace|promql|logql/i;

/** An ordinary call's node, from what it names: a command, a file verb, a search, or a tool. */
export function stepNode(call: {
	name: string;
	args: Record<string, unknown>;
	category?: string | null;
	gateway?: string | null;
}): NodeKind {
	if (call.gateway) return gatewayNode(call.gateway);
	const name = call.name.replace(/^`([\s\S]*)`$/, "$1").trim();
	const mcp = mcpTool(name);
	if (mcp)
		return TELEMETRY_TOOL.test(mcp.tool) || TELEMETRY_TOOL.test(mcp.server)
			? "telemetry"
			: "tool";
	const raw = call.args.command ?? call.args.cmd;
	const command = Array.isArray(raw) ? raw.join(" ") : raw;
	if (typeof command === "string" && command.trim())
		return TELEMETRY_COMMAND.test(command) ? "telemetry" : "command";
	if (call.category === "search") return "search";
	if (
		call.category === "file" ||
		typeof (call.args.path ?? call.args.file_path ?? call.args.filePath) ===
			"string"
	)
		return fileVerb(name) === "read" ? "read" : "edit";
	return "tool";
}

type HarnessCall = Extract<CanonicalEvent, { kind: "harness_tool_call" }>;

/**
 * The first line of what a PrismaLens tool returned, as plain text, at most 120 characters.
 * The data note leads every result, so it is skipped (the transcript shows it once), and so is raw JSON.
 */
export function outcomeLine(
	call: Pick<HarnessCall, "output" | "isError">,
): string | null {
	const line = (call.output ?? "")
		.split("\n")
		.map((l) =>
			Array.from(l, (ch) => {
				const code = ch.charCodeAt(0);
				return code < 32 || code === 127 ? " " : ch;
			})
				.join("")
				.trim(),
		)
		.find((l) => l && l !== HARNESS_DATA_NOTE);
	if (!line || /^[[{]/.test(line)) return call.isError ? "Failed" : null;
	return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export interface GatewayMatch {
	/** An ordinary call that is a PrismaLens tool, and the record of that call. */
	byCall: Map<string, HarnessCall>;
	/** Recorded PrismaLens calls no ordinary call carries, by `branchId-seq`. */
	unmatched: Set<string>;
}

/** Pairs each PrismaLens call with the agent's own call of it, in order, by server and name. */
export function matchGateway(events: readonly CanonicalEvent[]): GatewayMatch {
	const calls = events.filter(
		(e): e is HarnessCall => e.kind === "harness_tool_call",
	);
	const servers = new Set(calls.map((c) => c.server));
	const used = new Set<HarnessCall>();
	const byCall = new Map<string, HarnessCall>();
	for (const e of events) {
		if (e.kind !== "agent_step") continue;
		for (const c of e.toolCalls) {
			if (byCall.has(c.toolCallId)) continue;
			const mcp = mcpTool(c.name.replace(/^`([\s\S]*)`$/, "$1"));
			if (!mcp || !servers.has(mcp.server)) continue;
			// A deferred call is recorded under its target, marked `via: "tools_call"`.
			const target =
				plToolName(mcp.tool) === "pl_tools_call" &&
				typeof c.args.name === "string"
					? plToolName(c.args.name)
					: null;
			const open = calls.filter((h) => !used.has(h) && h.server === mcp.server);
			// A refused wrapper is recorded as `pl_tools_call` itself, with no `via` and the target in its input.
			const refused = (h: HarnessCall) =>
				plToolName(h.name) === "pl_tools_call" && !h.via;
			const call = target
				? (open.find(
						(h) =>
							refused(h) &&
							plToolName(
								String((h.input as { name?: unknown } | undefined)?.name),
							) === target,
					) ??
					open.find(
						(h) => h.via === "tools_call" && plToolName(h.name) === target,
					) ??
					open.find(refused))
				: open.find((h) => plToolName(h.name) === plToolName(mcp.tool));
			if (!call) continue;
			used.add(call);
			byCall.set(c.toolCallId, call);
		}
	}
	return {
		byCall,
		unmatched: new Set(
			calls.filter((c) => !used.has(c)).map((c) => `${c.branchId}-${c.seq}`),
		),
	};
}

/** A suspect's status, as the agent wrote it. */
export function statusWord(status: string): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Items of a turn the fold hides once it is done; the answer, artifacts and errors stay out. */
const FOLDABLE = new Set([
	"tools",
	"gateway",
	"finding",
	"thought",
	"line",
	"level",
	"prose",
	"ask",
]);
const WORK = new Set(["tools", "gateway", "finding", "thought"]);

export interface TurnFold {
	key: string;
	/** Where the fold's row sits: before the first item it hides. */
	at: number;
	hidden: number[];
	seconds: number | null;
}

interface FoldItem {
	kind: string;
	key: string;
	at?: string | null;
	until?: string | null;
	text?: string;
	state?: string;
}

const ms = (t?: string | null) => (t ? new Date(t).getTime() : Number.NaN);

/**
 * Each finished turn's work behind one row (#1020): a turn is what follows one of your
 * messages; the last thing the agent said in it is the answer and stays out.
 */
export function turnFolds(
	items: readonly FoldItem[],
	live: boolean,
): TurnFold[] {
	const folds: TurnFold[] = [];
	const starts = items.flatMap((it, i) =>
		it.kind === "operator" && it.state !== "queued" ? [i] : [],
	);
	for (let n = 0; n < starts.length; n++) {
		const start = starts[n] as number;
		const next = starts[n + 1];
		const end = next ?? items.length;
		if (next === undefined && live) continue;
		let answer = -1;
		for (let i = end - 1; i > start; i--)
			if (items[i]?.kind === "prose" && items[i]?.text) {
				answer = i;
				break;
			}
		const hidden: number[] = [];
		for (let i = start + 1; i < end; i++) {
			const it = items[i];
			if (it && i !== answer && FOLDABLE.has(it.kind)) hidden.push(i);
		}
		if (!hidden.some((i) => WORK.has(items[i]?.kind ?? ""))) continue;
		const from = ms(items[start]?.at);
		let to = Number.NaN;
		for (let i = start + 1; i < end; i++) {
			for (const t of [ms(items[i]?.until), ms(items[i]?.at)])
				if (!Number.isNaN(t) && (Number.isNaN(to) || t > to)) to = t;
		}
		folds.push({
			key: `fold-${items[start]?.key}`,
			at: hidden[0] as number,
			hidden,
			seconds:
				Number.isNaN(from) || Number.isNaN(to)
					? null
					: Math.max(0, Math.round((to - from) / 1000)),
		});
	}
	return folds;
}

/**
 * `Worked for 4m 12s, 3 steps`. Under a second (or no times) the duration goes,
 * since "0s" reads as broken; with no steps and no duration there is no line (#1101).
 */
export function workedLabel(
	seconds: number | null,
	steps?: number,
): string | null {
	const time =
		seconds !== null && seconds >= 1 ? ` for ${formatElapsed(seconds)}` : "";
	if (!time && steps === 0) return null;
	const count =
		steps === undefined ? "" : `, ${steps} ${steps === 1 ? "step" : "steps"}`;
	return `Worked${time}${count}`;
}

/** The tool views as a closed kind: each PrismaLens tool kind's transcript node (#1125). */
export const toolViews = defineClosed(
	"toolView",
	Object.keys(KIND_NODE) as ToolKind[],
	KIND_NODE,
);
