/**
 * ACP → canonical stream adapter (Tier-1, ADR-0008).
 *
 * Normalises a rented harness's native event stream — deepagents driven over the
 * **Agent Client Protocol** (`deepagents --acp`, JSON-RPC over stdio) — into the
 * ONE canonical vocabulary the UI consumes (`@prismalens/contracts`
 * `CanonicalEvent`). This seam is what lets every harness look identical to the
 * supervisor + drill-down UI.
 *
 * Supersedes the in-process `deepagentsjs` library + its LangChain
 * `streamEvents(v2)` adapter (ADR-0008, 2026-06-29): the deepagents CLI now runs
 * out-of-process and speaks ACP.
 *
 * ACP shape differences this adapter reconciles into the canonical stream:
 * - Assistant text arrives as incremental `agent_message_chunk` deltas, NOT one
 *   "model message end". We accumulate the deltas and flush them as the `text` of
 *   the `agent_step` that announces the next tool call (or as a trailing text-only
 *   step at branch end) — restoring the canonical "text + the tool calls it
 *   decided on" bundling.
 * - A tool call is announced by a `tool_call` update (status `pending`) and
 *   resolved by one or more `tool_call_update`s; we pair them by `toolCallId` and
 *   emit `tool_result` only on a terminal (`completed`/`failed`) update.
 * - ACP/deepagents is FLAT (verified 2026-06-29 — a subagent's tool calls surface
 *   as top-level siblings, no parent linkage), so `path` is always `[]` and
 *   `label` is null. Depth comes from an Agent-SDK harness, not here.
 *
 * Scope (Slice 0): a single branch. The adapter owns the per-branch monotonic
 * `seq` and stamps `ts`, so it is the single ordering authority for a branch's
 * stream (the UI's idempotent-upsert key is `(branchId, seq)`).
 */
import type {
	CanonicalEvent,
	InvestigationReport,
	ToolCategory,
} from "@prismalens/contracts";

/**
 * The structural subset of an ACP `session/update` payload's `update` object the
 * adapter relies on. Typed locally (not imported from an ACP SDK) so the
 * normaliser is decoupled from transport internals and trivially fixture-testable.
 */
export interface AcpUpdate {
	/**
	 * Discriminates the update: `agent_message_chunk` | `tool_call` |
	 * `tool_call_update` are the three we surface; everything else (thoughts, plan,
	 * mode/command updates) is ignored.
	 */
	sessionUpdate: string;
	/** Stable per-call id; pairs a `tool_call` with its `tool_call_update`(s). */
	toolCallId?: string;
	/** Human title of the tool call (e.g. "ls", "Execute: `kubectl get pods`"). */
	title?: string;
	/** ACP ToolKind: read | edit | delete | move | search | execute | think | fetch | other. */
	kind?: string;
	/** pending | in_progress | completed | failed. */
	status?: string;
	/** The structured tool input (e.g. `{ command, timeout }`); absent on some calls. */
	rawInput?: unknown;
	/**
	 * Content payload. For `agent_message_chunk` an object `{ type:"text", text }`;
	 * for `tool_call_update` an array of `{ type:"content", content:{ type:"text", text } }`.
	 */
	content?: unknown;
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

interface ToolMeta {
	name: string;
	kind?: string;
	rawInput?: unknown;
}

export class AcpAdapter {
	private seqCounter = 0;
	private readonly now: () => Date;
	private readonly previewLimit: number;
	/** Assistant text deltas accumulated since the last flush. */
	private pendingText = "";
	/** tool_call metadata kept to enrich the later tool_call_update (paired by id). */
	private readonly toolMeta = new Map<string, ToolMeta>();

	constructor(private readonly ctx: AdapterContext) {
		this.now = ctx.now ?? (() => new Date());
		this.previewLimit = ctx.previewLimit ?? DEFAULT_PREVIEW_LIMIT;
	}

	/**
	 * Map one ACP `update` to zero-or-one canonical event. Returns null for updates
	 * we don't surface (thought chunks, plan, mode/command updates) and for
	 * non-terminal tool progress frames (text deltas are accumulated, not emitted).
	 */
	normalize(u: AcpUpdate): CanonicalEvent | null {
		switch (u.sessionUpdate) {
			case "agent_message_chunk":
				this.pendingText += flattenAcpContent(u.content);
				return null;
			case "tool_call":
				return this.toolCall(u);
			case "tool_call_update":
				return this.toolResult(u);
			default:
				return null;
		}
	}

	/**
	 * Flush any accumulated assistant text as a text-only `agent_step`. Call before
	 * a terminal event so a pure-text turn (no tool call) is not lost.
	 */
	flushText(): CanonicalEvent | null {
		if (this.pendingText.length === 0) return null;
		const text = this.pendingText;
		this.pendingText = "";
		return { kind: "agent_step", ...this.base(), text, toolCalls: [] };
	}

	/** Terminal: a branch finished. Emitted by the runner, not the harness stream. */
	branchDone(reason: "submitted" | "budget" | "no_progress"): CanonicalEvent {
		return { kind: "branch_done", ...this.base(), reason };
	}

	/** Terminal: a branch failed. */
	error(message: string): CanonicalEvent {
		return { kind: "error", ...this.base(), message };
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

	private toolCall(u: AcpUpdate): CanonicalEvent {
		const toolCallId = u.toolCallId ?? "";
		const name = pickName(u);
		this.toolMeta.set(toolCallId, { name, kind: u.kind, rawInput: u.rawInput });
		// The text the model produced before deciding on this call becomes the step's text.
		const text = this.pendingText;
		this.pendingText = "";
		return {
			kind: "agent_step",
			...this.base(),
			text,
			toolCalls: [{ toolCallId, name, args: toArgs(u.rawInput) }],
		};
	}

	private toolResult(u: AcpUpdate): CanonicalEvent | null {
		const status = u.status ?? "completed";
		// Emit only on a terminal update; ignore pending/in_progress progress frames
		// (they would otherwise produce duplicate, partial tool_results).
		if (status !== "completed" && status !== "failed") return null;
		const toolCallId = u.toolCallId ?? "";
		const meta = this.toolMeta.get(toolCallId);
		const name = meta?.name ?? pickName(u);
		const ok = status !== "failed";
		const preview = truncate(flattenAcpContent(u.content), this.previewLimit);
		return {
			kind: "tool_result",
			...this.base(),
			result: {
				name,
				toolCategory: mapToolCategory(meta?.kind ?? u.kind),
				toolCallId,
				source: deriveSource(name, meta?.rawInput),
				ok,
				error: ok ? null : preview || "tool failed",
				preview,
			},
		};
	}

	/** Common per-event fields shared by every branch-scoped event. */
	private base(): {
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
			// ACP/deepagents is flat (verified 2026-06-29) — no nesting path, no label.
			path: [],
			seq: this.nextSeq(),
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

/** A tool call's display name: its title, else its kind, else a generic fallback. */
export function pickName(u: AcpUpdate): string {
	const title = typeof u.title === "string" ? u.title.trim() : "";
	if (title) return title;
	const kind = typeof u.kind === "string" ? u.kind.trim() : "";
	return kind || "tool";
}

/**
 * Normalise an ACP `rawInput` to the canonical `args` record. Objects pass through
 * (after an `unwrapInput` for any `{input:"<json>"}` wrapping); scalars are boxed.
 */
export function toArgs(rawInput: unknown): Record<string, unknown> {
	if (rawInput === undefined || rawInput === null) return {};
	if (typeof rawInput === "object" && !Array.isArray(rawInput)) {
		return unwrapInput(rawInput as Record<string, unknown>);
	}
	return { value: rawInput };
}

/**
 * deepagents may wrap a tool call's real args as `{ input: "<json-string>" }`.
 * Unwrap back to the structured args; pass anything else through untouched.
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
 * Flatten ACP content to text. Handles the two shapes we see: a single
 * `agent_message_chunk` block `{ type:"text", text }` and a `tool_call_update`'s
 * array of `{ type:"content", content:{ type:"text", text } }` blocks.
 */
export function flattenAcpContent(content: unknown): string {
	if (content === undefined || content === null) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map(flattenAcpBlock).join("");
	return flattenAcpBlock(content);
}

function flattenAcpBlock(block: unknown): string {
	if (typeof block === "string") return block;
	if (block && typeof block === "object") {
		const b = block as Record<string, unknown>;
		// agent_message_chunk: { type:"text", text }
		if (typeof b.text === "string") return b.text;
		// tool_call_update: { type:"content", content:{ type:"text", text } }
		if (b.content && typeof b.content === "object") {
			const inner = b.content as Record<string, unknown>;
			if (typeof inner.text === "string") return inner.text;
		}
	}
	return "";
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

/** Conservative ACP ToolKind → our ToolCategory; unknowns map to null (nullable). */
export function mapToolCategory(kind?: string): ToolCategory | null {
	switch (kind) {
		case "search":
			return "search";
		case "read":
		case "edit":
		case "move":
		case "delete":
			return "file";
		default:
			return null;
	}
}

/** Map an ACP prompt `stopReason` to the supervisor's branch-completion reason. */
export function mapStopReason(
	stopReason: string | undefined,
): "submitted" | "budget" | "no_progress" {
	switch (stopReason) {
		case "end_turn":
			return "submitted";
		case "max_tokens":
		case "max_turn_requests":
			return "budget";
		default:
			// refusal, cancelled, or unknown — nothing actionable was produced.
			return "no_progress";
	}
}

function truncate(s: string, limit: number): string {
	return s.length > limit ? `${s.slice(0, limit)}…` : s;
}
