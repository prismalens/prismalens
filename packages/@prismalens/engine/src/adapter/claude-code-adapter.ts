// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Claude Code (Agent SDK) → canonical stream adapter (Tier-2 deep path, ADR-0008).
 *
 * Normalises the Claude Agent SDK message stream (`@anthropic-ai/claude-agent-sdk`
 * `query()`) into the canonical `CanonicalEvent` vocabulary. Unlike deepagents/ACP
 * (which is FLAT), the Agent SDK exposes the real subagent tree via
 * `parent_tool_use_id`: a Task tool-call spawns a subagent whose own messages carry
 * that id as their parent. We resolve that into the canonical `path` + `label`, so
 * the drill-down UI gets genuine depth from this harness (the ADR's "depth comes
 * from an Agent-SDK harness" claim).
 */
import type {
	CanonicalEvent,
	InvestigationReport,
	ToolCategory,
} from "@prismalens/contracts";
import { type AdapterContext, deriveSource } from "./acp-adapter.js";

/** Structural subset of a Claude Agent SDK content block we consume. */
export interface SdkContentBlock {
	type: string;
	/** text block */
	text?: string;
	/** tool_use block */
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	/** tool_result block */
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
}

/** Structural subset of a Claude Agent SDK message (`SDKMessage`). */
export interface SdkMessage {
	/** "assistant" | "user" | "result" | "system" | "stream_event" */
	type: string;
	/** Set when this message belongs to a subagent spawned by a Task tool-call. */
	parent_tool_use_id?: string | null;
	message?: { role?: string; content?: SdkContentBlock[] | string };
	/** result messages: "success" | "error_max_turns" | "error_during_execution" */
	subtype?: string;
	result?: string;
	is_error?: boolean;
}

const DEFAULT_PREVIEW_LIMIT = 4000;

interface BaseFields {
	runId: string;
	branchId: string;
	path: string[];
	seq: number;
	label: string | null;
	ts: string;
}

export class ClaudeCodeAdapter {
	private seqCounter = 0;
	private readonly now: () => Date;
	private readonly previewLimit: number;
	/** Task tool_use_id → human subagent label (for depth resolution). */
	private readonly taskLabels = new Map<string, string>();
	/** tool_use_id → {name,input} so a later tool_result can be named + sourced. */
	private readonly toolMeta = new Map<
		string,
		{ name: string; input?: unknown }
	>();

	constructor(private readonly ctx: AdapterContext) {
		this.now = ctx.now ?? (() => new Date());
		this.previewLimit = ctx.previewLimit ?? DEFAULT_PREVIEW_LIMIT;
	}

	/** Map one SDK message to zero-or-more canonical events. */
	normalize(m: SdkMessage): CanonicalEvent[] {
		switch (m.type) {
			case "assistant":
				return this.assistant(m);
			case "user":
				return this.toolResults(m);
			default:
				return [];
		}
	}

	/** Map a terminal `result` SDK message to the branch's terminal event. */
	terminalFromResult(m: SdkMessage): CanonicalEvent {
		if (m.subtype === "success") return this.branchDone("submitted");
		if (m.subtype === "error_max_turns") return this.branchDone("budget");
		return this.error(
			m.result ?? `claude code ended: ${m.subtype ?? "unknown"}`,
		);
	}

	branchDone(reason: "submitted" | "budget" | "no_progress"): CanonicalEvent {
		return { kind: "branch_done", ...this.base(null), reason };
	}

	error(message: string): CanonicalEvent {
		return { kind: "error", ...this.base(null), message };
	}

	report(report: InvestigationReport): CanonicalEvent {
		return {
			kind: "report",
			runId: this.ctx.runId,
			seq: this.nextSeq(),
			ts: this.now().toISOString(),
			report,
		};
	}

	// --- internals ---

	private assistant(m: SdkMessage): CanonicalEvent[] {
		const content = m.message?.content;
		const blocks: SdkContentBlock[] = Array.isArray(content) ? content : [];
		const text =
			typeof content === "string"
				? content
				: blocks
						.filter((b) => b.type === "text")
						.map((b) => b.text ?? "")
						.join("");
		const toolUses = blocks.filter((b) => b.type === "tool_use");
		for (const tu of toolUses) {
			const id = tu.id ?? "";
			const name = tu.name ?? "tool";
			if (id) this.toolMeta.set(id, { name, input: tu.input });
			if (id && name === "Task")
				this.taskLabels.set(id, pickTaskLabel(tu.input));
		}
		if (!text && toolUses.length === 0) return [];
		return [
			{
				kind: "agent_step",
				...this.base(m.parent_tool_use_id ?? null),
				text,
				toolCalls: toolUses.map((tu) => ({
					toolCallId: tu.id ?? "",
					name: tu.name ?? "tool",
					args: asRecord(tu.input),
				})),
			},
		];
	}

	private toolResults(m: SdkMessage): CanonicalEvent[] {
		const content = m.message?.content;
		if (!Array.isArray(content)) return [];
		const out: CanonicalEvent[] = [];
		for (const b of content) {
			if (b.type !== "tool_result") continue;
			const id = b.tool_use_id ?? "";
			const meta = this.toolMeta.get(id);
			const name = meta?.name ?? "tool";
			const ok = b.is_error !== true;
			const preview = truncate(flattenContent(b.content), this.previewLimit);
			out.push({
				kind: "tool_result",
				...this.base(m.parent_tool_use_id ?? null),
				result: {
					name,
					toolCategory: mapToolCategory(name),
					toolCallId: id,
					source: deriveSource(name, meta?.input),
					ok,
					error: ok ? null : preview || "tool failed",
					preview,
				},
			});
		}
		return out;
	}

	/** Resolve depth from the spawning Task tool-call (deep, unlike flat ACP). */
	private base(parentToolUseId: string | null): BaseFields {
		const label = parentToolUseId
			? (this.taskLabels.get(parentToolUseId) ?? parentToolUseId)
			: null;
		return {
			runId: this.ctx.runId,
			branchId: this.ctx.branchId,
			path: label ? [label] : [],
			seq: this.nextSeq(),
			label,
			ts: this.now().toISOString(),
		};
	}

	private nextSeq(): number {
		return this.seqCounter++;
	}
}

// =============================================================================
// pure helpers
// =============================================================================

function pickTaskLabel(input: unknown): string {
	if (input && typeof input === "object") {
		const o = input as Record<string, unknown>;
		if (typeof o.subagent_type === "string" && o.subagent_type)
			return o.subagent_type;
		if (typeof o.description === "string" && o.description)
			return o.description.slice(0, 40);
	}
	return "task";
}

function asRecord(input: unknown): Record<string, unknown> {
	if (input && typeof input === "object" && !Array.isArray(input)) {
		return input as Record<string, unknown>;
	}
	return input === undefined || input === null ? {} : { value: input };
}

/** Flatten Agent-SDK content (string | block array | block) to text. */
export function flattenContent(content: unknown): string {
	if (content === undefined || content === null) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map(flattenBlock).join("");
	return flattenBlock(content);
}

function flattenBlock(block: unknown): string {
	if (typeof block === "string") return block;
	if (block && typeof block === "object") {
		const t = (block as Record<string, unknown>).text;
		if (typeof t === "string") return t;
	}
	return "";
}

function mapToolCategory(name: string): ToolCategory | null {
	const n = name.toLowerCase();
	if (n === "read" || n === "write" || n === "edit" || n === "multiedit")
		return "file";
	if (n === "grep" || n === "glob") return "search";
	return null;
}

function truncate(s: string, cap: number): string {
	return s.length > cap ? `${s.slice(0, cap)}…` : s;
}
