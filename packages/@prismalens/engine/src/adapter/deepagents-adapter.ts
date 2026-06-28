/**
 * deepagents → canonical stream adapter (Tier-1, ADR-0008).
 *
 * Normalises a rented harness's native event stream (deepagents, via LangChain
 * `streamEvents(v2)`) into the ONE canonical vocabulary the UI consumes
 * (`@prismalens/contracts` `CanonicalEvent`). This seam is what lets every
 * harness look identical to the supervisor + drill-down UI.
 *
 * Scope (Slice 0): a single branch. The adapter owns the per-branch monotonic
 * `seq` and stamps `ts`, so it is the single ordering authority for a branch's
 * stream (the UI's idempotent-upsert key is `(branchId, seq)`). `agent_step` and
 * `tool_result` are derived from harness events; the terminal `branch_done` /
 * `error` / `report` events are emitted by the runner through the helper methods
 * here, so they share the same seq counter and clock.
 */
import type { CanonicalEvent, InvestigationReport } from "@prismalens/contracts";

/**
 * The structural subset of a LangChain `streamEvents(v2)` event the adapter
 * relies on. Typed locally (not imported from @langchain) so the normaliser is
 * decoupled from harness internals and trivially testable with fixtures.
 */
export interface HarnessStreamEvent {
	/** e.g. "on_chat_model_end", "on_tool_end" — the only two kinds we surface. */
	event: string;
	/** Runnable name — for a tool event this is the tool name. */
	name: string;
	run_id: string;
	metadata?: Record<string, unknown>;
	data?: {
		input?: unknown;
		output?: unknown;
		[k: string]: unknown;
	};
}

/** A LangChain tool-call as it appears on an AIMessage's `tool_calls`. */
interface LcToolCall {
	id?: string;
	name: string;
	args?: Record<string, unknown>;
}

export interface AdapterContext {
	/** The investigation run id (== Investigation.id; 1 run = 1 investigation row). */
	runId: string;
	/** Slice 0: a single constant branch. Fan-out (Slice 1) = one adapter per branch. */
	branchId: string;
	/** Injectable clock — tests pass a fixed one. */
	now?: () => Date;
	/** Max chars retained in a tool-result preview. */
	previewLimit?: number;
}

const DEFAULT_PREVIEW_LIMIT = 4000;

export class DeepAgentsAdapter {
	private seqCounter = 0;
	private readonly now: () => Date;
	private readonly previewLimit: number;

	constructor(private readonly ctx: AdapterContext) {
		this.now = ctx.now ?? (() => new Date());
		this.previewLimit = ctx.previewLimit ?? DEFAULT_PREVIEW_LIMIT;
	}

	/**
	 * Map one harness stream event to zero-or-one canonical event. Returns null
	 * for events we don't surface (chain lifecycle, model/tool starts, token
	 * streams, etc.).
	 */
	normalize(ev: HarnessStreamEvent): CanonicalEvent | null {
		switch (ev.event) {
			case "on_chat_model_end":
				return this.agentStep(ev);
			case "on_tool_end":
				return this.toolResult(ev);
			default:
				return null;
		}
	}

	/** Terminal: a branch finished. Emitted by the runner, not the harness stream. */
	branchDone(reason: "submitted" | "budget" | "no_progress"): CanonicalEvent {
		return { kind: "branch_done", ...this.base([]), reason };
	}

	/** Terminal: a branch failed. */
	error(message: string): CanonicalEvent {
		return { kind: "error", ...this.base([]), message };
	}

	/** Terminal: the run-level reduced report. */
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

	private agentStep(ev: HarnessStreamEvent): CanonicalEvent {
		const output = (ev.data?.output ?? {}) as {
			content?: unknown;
			tool_calls?: LcToolCall[];
		};
		const toolCalls = (output.tool_calls ?? []).map((tc) => ({
			toolCallId: tc.id ?? "",
			name: tc.name,
			args: unwrapInput(tc.args ?? {}),
		}));
		return {
			kind: "agent_step",
			...this.base(parsePath(ev.metadata)),
			text: flattenContent(output.content),
			toolCalls,
		};
	}

	private toolResult(ev: HarnessStreamEvent): CanonicalEvent {
		const output = (ev.data?.output ?? {}) as {
			content?: unknown;
			status?: string;
			tool_call_id?: string;
		};
		// A failed tool is NOT a thrown error: LangGraph's ToolNode has
		// handleToolErrors=true and emits the failure as a normal end event whose
		// ToolMessage carries status:"error". Derive `ok` from status, not arrival.
		const ok = output.status !== "error";
		const preview = truncate(flattenContent(output.content), this.previewLimit);
		return {
			kind: "tool_result",
			...this.base(parsePath(ev.metadata)),
			result: {
				name: ev.name,
				toolCallId: output.tool_call_id ?? "",
				source: deriveSource(ev.name, ev.data?.input),
				ok,
				error: ok ? null : preview,
				preview,
			},
		};
	}

	/** Common per-event fields shared by every branch-scoped event. */
	private base(path: string[]): {
		runId: string;
		branchId: string;
		path: string[];
		seq: number;
		label: string | null;
		ts: string;
	} {
		return {
			runId: this.ctx.runId,
			branchId: this.ctx.branchId,
			path,
			seq: this.nextSeq(),
			// label (subagent_type via run_id parentage) deferred — see ADR-0008.
			label: null,
			ts: this.now().toISOString(),
		};
	}

	private nextSeq(): number {
		return this.seqCounter++;
	}
}

// =============================================================================
// pure helpers (exported for unit tests)
// =============================================================================

/**
 * deepagents wraps a sub-agent/task tool call's real args as
 * `{ input: "<json-string>" }`. Unwrap back to the structured args; pass
 * anything else through untouched (a wrapped form is itself a valid record, so
 * a missed unwrap would silently store the wrong shape).
 */
export function unwrapInput(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const keys = Object.keys(args);
	if (
		keys.length === 1 &&
		keys[0] === "input" &&
		typeof args.input === "string"
	) {
		try {
			const parsed = JSON.parse(args.input);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// not JSON — leave as-is
		}
	}
	return args;
}

/**
 * Chat-model content is either a plain string or an array of content blocks
 * (e.g. Anthropic). Flatten to concatenated text.
 */
export function flattenContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (typeof block === "string") return block;
				if (block && typeof block === "object" && "text" in block) {
					const t = (block as { text?: unknown }).text;
					return typeof t === "string" ? t : "";
				}
				return "";
			})
			.join("");
	}
	return "";
}

/**
 * Structural nesting depth from the LangGraph checkpoint ns
 * (`{node}:{uuid}|{node}:{uuid}`). Node names only — uuids stripped and the
 * synthetic `tools` wrapper segment collapsed. These are NOT subagent names.
 */
export function parsePath(metadata?: Record<string, unknown>): string[] {
	const ns = metadata?.langgraph_checkpoint_ns;
	if (typeof ns !== "string" || ns.length === 0) return [];
	return ns
		.split("|")
		.map((seg) => seg.split(":")[0])
		.filter((node) => node.length > 0 && node !== "tools");
}

/** Human-readable provenance for a tool call: the tool + its (unwrapped) input. */
export function deriveSource(name: string, input: unknown): string {
	if (input === undefined || input === null) return name;
	const args =
		typeof input === "object" && !Array.isArray(input)
			? unwrapInput(input as Record<string, unknown>)
			: input;
	let rendered: string;
	try {
		rendered = JSON.stringify(args);
	} catch {
		rendered = String(args);
	}
	return `${name}(${rendered})`;
}

function truncate(s: string, limit: number): string {
	return s.length > limit ? `${s.slice(0, limit)}…` : s;
}
