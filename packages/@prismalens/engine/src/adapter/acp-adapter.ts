// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
 * - A sub-agent the agent announces with `subagent_update` (ACP's Subagent Sessions
 *   RFD) streams in its own session: its steps carry `path: [sessionId]` and its
 *   title as `label`. An agent that sends no sessions but stamps
 *   `_meta.claudeCode.parentToolUseId` nests under that call; anything else is the
 *   branch top, `path: []` (#1025).
 *
 * Scope (Slice 0): a single branch. The adapter owns the per-branch monotonic
 * `seq` and stamps `ts`, so it is the single ordering authority for a branch's
 * stream (the UI's idempotent-upsert key is `(branchId, seq)`).
 */
import type {
	Artifact,
	AskAnswer,
	AskClosedOutcome,
	AttachmentRef,
	CanonicalEvent,
	CompactionMethod,
	FollowUpKind,
	InvestigationReport,
	LimitWindow,
	OperatorMessageMode,
	PendingAsk,
	PermissionAskOutcome,
	PlanEntry,
	Quote,
	RecordedFinding,
	ReferenceRef,
	RunFailure,
	ToolCategory,
	TurnUsage,
} from "@prismalens/contracts/schemas";
import {
	type AskSource,
	PLAN_MAX_ENTRIES,
	SUBAGENT_TEXT_CAP,
	type SubagentState,
	THOUGHT_MAX_BYTES,
} from "@prismalens/contracts/schemas";
import type { GatewayCall } from "../run/gateway.js";
import { askIdentity } from "../run/permission.js";

/**
 * The structural subset of an ACP `session/update` payload's `update` object the
 * adapter relies on. Typed locally (not imported from an ACP SDK) so the
 * normaliser is decoupled from transport internals and trivially fixture-testable.
 */
export interface AcpUpdate {
	/**
	 * Discriminates the update: `agent_message_chunk` | `tool_call` |
	 * `tool_call_update`, `agent_thought_chunk` and `plan` are surfaced; everything
	 * else (mode and command updates) is ignored.
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
	/** `usage_update`: tokens in context, the window, and the cumulative cost when sent. */
	used?: number;
	size?: number;
	cost?: { amount?: unknown; currency?: unknown } | null;
	/** Codex's output: `{ formatted_output, exit_code }` for a command, `{ result, error }` for MCP; it sends no `content`. */
	rawOutput?: unknown;
	/** Harness extras; Claude Code names a call its own settings refused here. */
	_meta?: unknown;
	/** `plan`: the whole plan, replacing the last one. */
	entries?: unknown;
}

/** A call Claude Code's own permission rules refused: no ask reached PrismaLens or the user (#673 w7-6). */
/** Where a step belongs: the branch top, a sub-agent session, or under the call that started it. */
interface Lane {
	path: string[];
	label: string | null;
	/** Text deltas not yet flushed into a step. */
	text: string;
	/** Characters of a sub-agent's text kept so far, against SUBAGENT_TEXT_CAP. */
	kept: number;
	capped: boolean;
}

interface Subagent {
	lane: Lane;
	/** The lane it was started from, where its `subagent` events sit. */
	parent: Lane;
	title: string;
	state: SubagentState;
}

const newLane = (path: string[], label: string | null): Lane => ({
	path,
	label,
	text: "",
	kept: 0,
	capped: false,
});

export const RULE_DENIED =
	"Denied by a permission rule in your Claude Code settings.";

export interface AdapterContext {
	/** The investigation run id (== Investigation.id; 1 run = 1 investigation row). */
	runId: string;
	/** Slice 0: a single constant branch. Fan-out (Slice 1) = one adapter per branch. */
	branchId: string;
	/** Injectable clock — tests pass a fixed one. */
	now?: () => Date;
	/** Max chars retained in a tool-result preview. */
	previewLimit?: number;
	/** First `seq`; a follow-up continues after the stored events (#747). */
	seqStart?: number;
}

const DEFAULT_PREVIEW_LIMIT = 4000;

interface ToolMeta {
	name: string;
	kind?: string;
	rawInput?: unknown;
	/** Latest output an earlier update carried, cut to what a preview can show. */
	output?: string;
}

export type HarnessToolsTurn = "first" | "follow-up";

/** The quotes and references a message's events show. */
export interface MessageContextRefs {
	quotes?: Quote[];
	references?: ReferenceRef[];
}

function contextRefs(c: MessageContextRefs | undefined): MessageContextRefs {
	return {
		...(c?.quotes?.length ? { quotes: c.quotes } : {}),
		...(c?.references?.length ? { references: c.references } : {}),
	};
}

export class AcpAdapter {
	private seqCounter = 0;
	private readonly now: () => Date;
	private readonly previewLimit: number;
	/** The branch top; each sub-agent and nested call gets its own lane (#1025). */
	private readonly top: Lane = newLane([], null);
	/** The lane the event being built is stamped with. */
	private lane: Lane = this.top;
	/** Sub-agent sessions by ACP session id. */
	private readonly subagents = new Map<string, Subagent>();
	/** Lanes of calls stamped with a `parentToolUseId`, by that id (the fallback). */
	private readonly nested = new Map<string, Lane>();
	/** tool_call metadata kept to enrich the later tool_call_update (paired by id). */
	private readonly toolMeta = new Map<string, ToolMeta>();
	/** Thought deltas since the last step; one `thought` event carries them (#1024). */
	private pendingThought = "";
	/** UTF-8 bytes of thinking this turn has kept; past THOUGHT_MAX_BYTES the rest is dropped. */
	private thoughtBytes = 0;
	private thoughtCut = false;

	constructor(private readonly ctx: AdapterContext) {
		this.now = ctx.now ?? (() => new Date());
		this.previewLimit = ctx.previewLimit ?? DEFAULT_PREVIEW_LIMIT;
		this.seqCounter = ctx.seqStart ?? 0;
	}

	/**
	 * Map one ACP `update` to the canonical events it means: none for what we
	 * don't surface (mode updates, progress frames), one for most, two for a call
	 * announced already finished. Held thinking goes out before the next event.
	 */
	events(u: AcpUpdate, sessionId?: string): CanonicalEvent[] {
		if (u.sessionUpdate === "subagent_update")
			return this.subagentUpdate(u, sessionId);
		this.lane = this.laneOf(u, sessionId);
		try {
			// Thinking is kept for the main agent only; a sub-agent's view shows its words and steps.
			if (u.sessionUpdate === "agent_thought_chunk") {
				if (this.lane === this.top)
					this.addThought(flattenAcpContent(u.content));
				return [];
			}
			if (this.lane !== this.top) return this.laneEvents(u);
			const thought = this.flushThought();
			const out = this.laneEvents(u);
			return thought ? [thought, ...out] : out;
		} finally {
			this.lane = this.top;
		}
	}

	/** Who asked: a sub-agent session the agent announced, else the main agent. */
	askSource(sessionId?: string): AskSource {
		const sub = sessionId ? this.subagents.get(sessionId) : undefined;
		return sub && sessionId
			? { kind: "subagent", sessionId, title: sub.title.slice(0, 200) }
			: { kind: "agent" };
	}

	/**
	 * The run ended with sub-agents still running; they end with its session. A stop
	 * cancels them, any other end leaves what they did as all there is.
	 */
	endSubagents(stopped: boolean): CanonicalEvent[] {
		const out: CanonicalEvent[] = [];
		for (const lane of [
			...[...this.subagents.values()].map((s) => s.lane),
			...this.nested.values(),
		]) {
			const flushed = this.flushLane(lane);
			if (flushed) out.push(flushed);
		}
		for (const [sessionId, sub] of this.subagents) {
			if (sub.state !== "running") continue;
			sub.state = stopped ? "cancelled" : "completed";
			out.push(this.subagentEvent(sessionId, "state", { state: sub.state }));
		}
		return out;
	}

	private laneEvents(u: AcpUpdate): CanonicalEvent[] {
		switch (u.sessionUpdate) {
			case "plan": {
				const entries = planEntries(u.entries);
				return entries ? [{ kind: "plan", ...this.base(), entries }] : [];
			}
			case "agent_message_chunk":
				return this.addText(flattenAcpContent(u.content));
			case "tool_call": {
				const step = this.toolCall(u);
				const done = isTerminal(u.status) ? this.toolResult(u) : null;
				const out = done ? [step, done] : [step];
				const sub = this.subagentOf(this.lane);
				if (sub)
					out.push(
						this.subagentEvent(sub, "step", {
							step: pickName(u).slice(0, 300),
						}),
					);
				return out;
			}
			case "tool_call_update": {
				const toolCallId = u.toolCallId ?? "";
				const filled = this.mergeToolMeta(toolCallId, u);
				this.retainOutput(toolCallId, u);
				// ACP sends only changed fields: no status means the call still runs (#820).
				if (isTerminal(u.status)) {
					const done = this.toolResult(u);
					return done ? [done] : [];
				}
				if (!filled) return [];
				const again = [this.reannounce(toolCallId)];
				// Claude Code opens a call as "Terminal" and names it later: the step line follows.
				const sub = this.subagentOf(this.lane);
				const name = this.toolMeta.get(toolCallId)?.name;
				if (sub && name)
					again.push(
						this.subagentEvent(sub, "step", { step: name.slice(0, 300) }),
					);
				return again;
			}
			default:
				return [];
		}
	}

	private addThought(delta: string): void {
		let room = THOUGHT_MAX_BYTES - this.thoughtBytes;
		let kept = "";
		// Whole code points only, so a cut never leaves half a character.
		for (const ch of delta) {
			const size = Buffer.byteLength(ch, "utf8");
			if (size > room) {
				this.thoughtCut = true;
				break;
			}
			kept += ch;
			room -= size;
		}
		this.pendingThought += kept;
		this.thoughtBytes = THOUGHT_MAX_BYTES - room;
	}

	/** The thinking held since the last step, as one event; null when there is none. */
	flushThought(): CanonicalEvent | null {
		if (!this.pendingThought) return null;
		const text = this.pendingThought;
		this.pendingThought = "";
		return {
			kind: "thought",
			...this.base(),
			text,
			...(this.thoughtCut ? { truncated: true as const } : {}),
		};
	}

	/** Held thinking, then held text: what a pause, an ask or a turn's end must not lose. */
	flush(): CanonicalEvent[] {
		const out: CanonicalEvent[] = [];
		const thought = this.flushThought();
		if (thought) out.push(thought);
		const text = this.flushText();
		if (text) out.push(text);
		return out;
	}

	/** {@link events}, first event only: kept for callers that map one update to one event. */
	normalize(u: AcpUpdate): CanonicalEvent | null {
		return this.events(u)[0] ?? null;
	}

	/**
	 * Flush any accumulated assistant text as a text-only `agent_step`. Call before
	 * a terminal event so a pure-text turn (no tool call) is not lost.
	 */
	flushText(): CanonicalEvent | null {
		return this.flushLane(this.top);
	}

	private flushLane(lane: Lane): CanonicalEvent | null {
		if (lane.text.length === 0) return null;
		const text = lane.text;
		lane.text = "";
		const was = this.lane;
		this.lane = lane;
		try {
			return { kind: "agent_step", ...this.base(), text, toolCalls: [] };
		} finally {
			this.lane = was;
		}
	}

	/** A sub-agent's words stop at SUBAGENT_TEXT_CAP, said once; the top's are never capped. */
	private addText(chunk: string): CanonicalEvent[] {
		const lane = this.lane;
		if (!chunk) return [];
		if (lane === this.top) {
			lane.text += chunk;
			return [];
		}
		if (lane.capped) return [];
		const room = SUBAGENT_TEXT_CAP - lane.kept;
		lane.text += chunk.slice(0, room);
		lane.kept += Math.min(chunk.length, room);
		if (chunk.length <= room) return [];
		lane.capped = true;
		const sub = this.subagentOf(lane);
		return sub ? [this.subagentEvent(sub, "state", { textCapped: true })] : [];
	}

	/** A child session's lane, a nested call's, or the top. */
	private laneOf(u: AcpUpdate, sessionId: string | undefined): Lane {
		if (sessionId)
			// Traffic before its announcement still belongs to the child, never the top.
			return (this.subagents.get(sessionId) ?? this.announce(sessionId, {}))
				.lane;
		const parent = parentToolUseOf(u._meta);
		const call = parent ? this.toolMeta.get(parent) : undefined;
		if (!parent || !call) return this.top;
		let lane = this.nested.get(parent);
		if (!lane) {
			lane = newLane([parent], call.name);
			this.nested.set(parent, lane);
		}
		return lane;
	}

	private subagentOf(lane: Lane): string | null {
		for (const [id, sub] of this.subagents) if (sub.lane === lane) return id;
		return null;
	}

	/** First sight of a child session; a nested child's lane sits under its parent's. */
	private announce(
		sessionId: string,
		fields: { title?: string; task?: string },
		parent: Lane = this.top,
	): Subagent {
		const title = fields.title?.trim() || fields.task?.trim() || "Sub-agent";
		const sub: Subagent = {
			title,
			state: "running",
			parent,
			lane: newLane([...parent.path, sessionId], title),
		};
		this.subagents.set(sessionId, sub);
		return sub;
	}

	/** ACP `subagent_update`: an omitted field keeps its value; a concrete state replaces the last. */
	private subagentUpdate(u: AcpUpdate, on?: string): CanonicalEvent[] {
		const raw = u as unknown as Record<string, unknown>;
		const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : "";
		if (!sessionId) return [];
		const title =
			typeof raw.title === "string" && raw.title.trim()
				? raw.title.trim().slice(0, 200)
				: undefined;
		const task =
			typeof raw.description === "string" && raw.description.trim()
				? raw.description.trim().slice(0, 4000)
				: undefined;
		const state = subagentState(raw.state);
		const canCancel =
			"capabilities" in raw
				? (raw.capabilities as { cancel?: unknown } | null)?.cancel != null
				: undefined;
		const known = this.subagents.get(sessionId);
		if (!known) {
			// Sent on its immediate parent's session: a child of a child nests under it.
			const parent = on ? this.subagents.get(on)?.lane : undefined;
			const sub = this.announce(sessionId, { title, task }, parent);
			if (state) sub.state = state;
			return [
				this.subagentEvent(sessionId, "started", {
					title: sub.title.slice(0, 200),
					state: sub.state,
					canCancel: canCancel ?? false,
					...(task ? { task } : {}),
				}),
			];
		}
		if (title) {
			known.title = title;
			known.lane.label = title;
		}
		if (state) known.state = state;
		const fields = {
			...(title ? { title } : {}),
			...(task ? { task } : {}),
			...(state ? { state } : {}),
			...(canCancel !== undefined ? { canCancel } : {}),
		};
		if (Object.keys(fields).length === 0) return [];
		const out: CanonicalEvent[] = [];
		const flushed =
			state && state !== "running" ? this.flushLane(known.lane) : null;
		if (flushed) out.push(flushed);
		out.push(this.subagentEvent(sessionId, "state", fields));
		return out;
	}

	private subagentEvent(
		sessionId: string,
		phase: "started" | "state" | "step",
		fields: {
			title?: string;
			task?: string;
			state?: SubagentState;
			step?: string;
			canCancel?: boolean;
			textCapped?: true;
		},
	): CanonicalEvent {
		// A sub-agent's record sits in the lane that started it, where the transcript keeps its node.
		const was = this.lane;
		this.lane = this.subagents.get(sessionId)?.parent ?? this.top;
		try {
			return { kind: "subagent", ...this.base(), sessionId, phase, ...fields };
		} finally {
			this.lane = was;
		}
	}

	/** Terminal: a branch finished. Emitted by the runner, not the harness stream. */
	branchDone(reason: "submitted" | "budget" | "no_progress"): CanonicalEvent {
		return { kind: "branch_done", ...this.base(), reason };
	}

	/** The operator's text as the session received it (#743). */
	operatorMessage(
		text: string,
		mode: OperatorMessageMode,
		delivered: boolean,
		resumed?: { name: string; head: string }[],
		attachments?: AttachmentRef[],
		followUp?: FollowUpKind,
		messageId?: string,
		via?: Extract<CanonicalEvent, { kind: "operator_message" }>["via"],
		context?: MessageContextRefs,
		delivers?: string[],
	): CanonicalEvent {
		// Each message the agent takes starts a turn, with its own thinking budget.
		this.thoughtBytes = 0;
		this.thoughtCut = false;
		if (delivered) this.turnLine = messageId;
		return {
			kind: "operator_message",
			...this.base(),
			text,
			mode,
			delivered,
			...(resumed ? { resumed } : {}),
			...(followUp ? { followUp } : {}),
			...(attachments?.length ? { attachments } : {}),
			...contextRefs(context),
			...(messageId ? { messageId } : {}),
			...(delivers?.length ? { delivers } : {}),
			...(via ? { via } : {}),
		};
	}

	/** A message now waits for the agent's next pause (#820). */
	messageQueued(
		messageId: string,
		text: string,
		attachments?: AttachmentRef[],
		context?: MessageContextRefs,
		delivers?: string[],
	): CanonicalEvent {
		return {
			kind: "message_queued",
			...this.base(),
			messageId,
			text,
			...(attachments?.length ? { attachments } : {}),
			...contextRefs(context),
			...(delivers?.length ? { delivers } : {}),
		};
	}

	/** A queued message changed (`text`) or was withdrawn (`null`) before it was claimed (#1024). */
	messageChanged(messageId: string, text: string | null): CanonicalEvent {
		return text === null
			? { kind: "message_withdrawn", ...this.base(), messageId }
			: { kind: "message_edited", ...this.base(), messageId, text };
	}

	/** Any ask the run now waits on (#1024). */
	askOpened(ask: PendingAsk): CanonicalEvent {
		return { kind: "ask_opened", ...this.base(), ask };
	}

	askClosed(
		askId: string,
		outcome: AskClosedOutcome,
		answer?: AskAnswer,
	): CanonicalEvent {
		return {
			kind: "ask_closed",
			...this.base(),
			askId,
			outcome,
			...(answer ? { answer } : {}),
		};
	}

	/** The harness's answer to `session/set_config_option` before the first prompt (R4.2). */
	sessionConfig(
		option: "model" | "effort",
		value: string,
		accepted: boolean,
	): CanonicalEvent {
		return { kind: "session_config", ...this.base(), option, value, accepted };
	}

	/** One call to PrismaLens's own tools, as the gateway saw it (#848). */
	harnessToolCall(
		server: string,
		call: GatewayCall,
		turn: HarnessToolsTurn,
	): CanonicalEvent {
		return { kind: "harness_tool_call", ...this.base(), server, turn, ...call };
	}

	/** An HTML artifact the agent published through PrismaLens's tool (#871). */
	artifactPublished(artifact: Artifact): CanonicalEvent {
		return { kind: "artifact_published", ...this.base(), artifact };
	}

	/** Evidence or a hypothesis the agent recorded through PrismaLens's tool (#930). */
	findingRecorded(finding: RecordedFinding): CanonicalEvent {
		return { kind: "finding_recorded", ...this.base(), finding };
	}

	/** The turn's summary of PrismaLens's own tools: connected, and each tool called (#848). */
	harnessTools(
		server: string,
		turn: HarnessToolsTurn,
		connected: boolean,
		calls: { name: string; firstCalledAt: string; count: number }[],
		reservedBy?: string | null,
	): CanonicalEvent {
		return {
			kind: "harness_tools",
			...this.base(),
			server,
			turn,
			connected,
			...(reservedBy ? { reservedBy } : {}),
			calls,
		};
	}

	/** The agent asked before a tool call (#673 w21); the call's own update fills in what the ask omits. */
	permissionAsk(
		askId: string,
		toolCall:
			| {
					title?: string;
					toolCallId?: string;
					kind?: string;
					rawInput?: unknown;
					locations?: { path?: string }[];
					_meta?: unknown;
			  }
			| undefined,
		expiresAt: Date,
		clamped = false,
		sessionId?: string,
	): CanonicalEvent {
		const meta = toolCall?.toolCallId
			? this.toolMeta.get(toolCall.toolCallId)
			: undefined;
		const input =
			Object.keys(toArgs(toolCall?.rawInput)).length > 0
				? toolCall?.rawInput
				: meta?.rawInput;
		const detail = askDetail(input, toolCall?.locations);
		const title = toolCall?.title?.trim() || meta?.name || "A tool call";
		// An MCP tool's arguments are what it does, whatever command or path one names (#820).
		const shown = detail && !title.startsWith("mcp__") ? null : askInput(input);
		const server = mcpServerOf(toolCall?._meta);
		// From the request alone, as the run's policy sees it, so a remembered ask matches it (#1020).
		const identity = askIdentity(toolCall);
		return {
			kind: "permission_ask",
			...this.base(),
			askId,
			title,
			detail,
			toolKind: toolCall?.kind ?? meta?.kind ?? null,
			expiresAt: expiresAt.toISOString(),
			...(clamped ? { clamped } : {}),
			...(toolCall?.toolCallId ? { toolCallId: toolCall.toolCallId } : {}),
			...(shown ? { input: shown } : {}),
			...(server ? { server } : {}),
			...(identity ? { identity } : {}),
			...(sessionId ? { source: this.askSource(sessionId) } : {}),
		};
	}

	/** A compaction boundary in the transcript, with the context before and after when known (#1024). */
	compaction(
		phase: "started" | "completed" | "failed",
		method: CompactionMethod,
		counts: { before?: number; after?: number; instructions?: string } = {},
	): CanonicalEvent {
		return {
			kind: "compaction",
			...this.base(),
			phase,
			method,
			...(counts.before !== undefined ? { before: counts.before } : {}),
			...(counts.after !== undefined ? { after: counts.after } : {}),
			...(counts.instructions ? { instructions: counts.instructions } : {}),
		};
	}

	/** How the ask ended (#673 w21); `asked` names an ask the level answered, which showed no card. */
	permissionAnswer(
		askId: string,
		outcome: PermissionAskOutcome,
		asked?: { title?: string; toolCallId?: string; kind?: string },
	): CanonicalEvent {
		const meta = asked?.toolCallId
			? this.toolMeta.get(asked.toolCallId)
			: undefined;
		return {
			kind: "permission_answer",
			...this.base(),
			askId,
			outcome,
			...(asked
				? {
						title: asked.title?.trim() || meta?.name || "A tool call",
						toolKind: asked.kind ?? meta?.kind ?? null,
					}
				: {}),
		};
	}

	/** Terminal: a branch failed; `failure` when it was a classified provider stop (#1101). */
	error(message: string, failure?: RunFailure): CanonicalEvent {
		return {
			kind: "error",
			...this.base(),
			message,
			...(failure ? { failure } : {}),
		};
	}

	/** The id of the message the current turn sends, so a retry names its row (#1101). */
	private turnLine: string | undefined;

	/**
	 * The turn sits out a short provider wait, then sends the message again (#1101);
	 * `succeeded` records that try `attempt` went through at `at`.
	 */
	providerRetry(
		mode: "rate_limited" | "overloaded",
		attempt: number,
		maxAttempts: number,
		at: Date,
		phase: "waiting" | "succeeded" = "waiting",
	): CanonicalEvent {
		return {
			kind: "provider_retry",
			...this.base(),
			mode,
			attempt,
			maxAttempts,
			phase,
			at: at.toISOString(),
			...(this.turnLine ? { messageId: this.turnLine } : {}),
		};
	}

	/** A usage window as the agent reported it (#1101). */
	agentQuota(quota: {
		window?: LimitWindow;
		type?: string;
		usedPercent?: number;
		resetsAt?: string;
		status?: string;
	}): CanonicalEvent {
		return { kind: "agent_quota", ...this.base(), ...quota };
	}

	/** What one turn consumed, as the agent reported it (#1101). */
	turnUsage(usage: TurnUsage): CanonicalEvent {
		return { kind: "turn_usage", ...this.base(), usage };
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
		const text = this.lane.text;
		this.lane.text = "";
		return {
			kind: "agent_step",
			...this.base(),
			text,
			toolCalls: [{ toolCallId, name, args: toArgs(u.rawInput) }],
		};
	}

	/** The call again, with the command a later update filled in (#820): the step shows it before its result. */
	private reannounce(toolCallId: string): CanonicalEvent {
		const meta = this.toolMeta.get(toolCallId);
		return {
			kind: "agent_step",
			...this.base(),
			text: "",
			toolCalls: [
				{
					toolCallId,
					name: meta?.name ?? "tool",
					args: toArgs(meta?.rawInput),
				},
			],
		};
	}

	private toolResult(u: AcpUpdate): CanonicalEvent | null {
		const toolCallId = u.toolCallId ?? "";
		if (!isTerminal(u.status)) return null;
		const meta = this.toolMeta.get(toolCallId);
		const name = meta?.name ?? pickName(u);
		const ok = u.status !== "failed";
		const preview = ruleDenied(u._meta)
			? RULE_DENIED
			: truncate(toolOutputText(u) || (meta?.output ?? ""), this.previewLimit);
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

	/** ACP sends only changed fields: a later bare `completed` must not lose output an earlier update carried. */
	private retainOutput(toolCallId: string, u: AcpUpdate): void {
		const meta = this.toolMeta.get(toolCallId);
		const text = toolOutputText(u);
		if (meta && text) meta.output = text.slice(0, this.previewLimit + 1);
	}

	/**
	 * Claude Code opens a call with an empty rawInput and a generic title ("Terminal")
	 * and sends the command in a later update; keep the fuller one (walk f16).
	 */
	private mergeToolMeta(toolCallId: string, u: AcpUpdate): boolean {
		const meta = this.toolMeta.get(toolCallId);
		if (!meta) return false;
		const had = Object.keys(toArgs(meta.rawInput)).length;
		const now = Object.keys(toArgs(u.rawInput)).length;
		if (now > 0) meta.rawInput = u.rawInput;
		const title = typeof u.title === "string" ? u.title.trim() : "";
		const renamed = !!title && title !== meta.name;
		if (title) meta.name = title;
		// An input streamed field by field grows; each new field is news, a repeat is not.
		return now > had || (renamed && had === 0);
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
			path: [...this.lane.path],
			seq: this.nextSeq(),
			label: this.lane.label,
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
 * An ACP sub-agent state snapshot as one of PrismaLens's four; null leaves it as it
 * was. `unknown` (the child can no longer be observed) reads failed.
 */
export function subagentState(raw: unknown): SubagentState | null {
	if (!raw || typeof raw !== "object") return null;
	const { state, stopReason } = raw as {
		state?: unknown;
		stopReason?: unknown;
	};
	if (state === "running" || state === "requires_action") return "running";
	if (state === "idle")
		return stopReason === "cancelled"
			? "cancelled"
			: stopReason === "error"
				? "failed"
				: "completed";
	if (state === "unknown") return "failed";
	return null;
}

/** claude-agent-acp's `_meta.claudeCode.parentToolUseId`: the call a helper's step ran under. */
export function parentToolUseOf(meta: unknown): string | null {
	const id = (
		meta as { claudeCode?: { parentToolUseId?: unknown } } | undefined
	)?.claudeCode?.parentToolUseId;
	return typeof id === "string" && id ? id : null;
}

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
/** ACP plan entries, cut to what the contract keeps; null when the update carries no list. */
export function planEntries(raw: unknown): PlanEntry[] | null {
	if (!Array.isArray(raw)) return null;
	const out: PlanEntry[] = [];
	for (const e of raw.slice(0, PLAN_MAX_ENTRIES)) {
		if (!e || typeof e !== "object") continue;
		const { content, status, priority } = e as Record<string, unknown>;
		if (typeof content !== "string") continue;
		out.push({
			content: content.slice(0, 2000),
			status:
				status === "in_progress" || status === "completed" ? status : "pending",
			...(priority === "high" || priority === "medium" || priority === "low"
				? { priority }
				: {}),
		});
	}
	return out;
}

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

const ASK_DETAIL_LIMIT = 2000;

function isTerminal(status: string | undefined): boolean {
	return status === "completed" || status === "failed";
}

/** A call's input as indented JSON, for a tool that names no command or path (#820). */
export function askInput(rawInput: unknown): string | null {
	const args = toArgs(rawInput);
	if (Object.keys(args).length === 0) return null;
	let text: string;
	try {
		text = JSON.stringify(args, null, 2);
	} catch {
		return null;
	}
	return text.slice(0, ASK_DETAIL_LIMIT);
}

/** The tool's output text: `content` (Claude Code), else Codex's `rawOutput` or terminal `_meta`. */
export function toolOutputText(u: AcpUpdate): string {
	const fromContent = flattenAcpContent(u.content);
	if (fromContent) return fromContent;
	const out = u.rawOutput;
	if (typeof out === "string") return out;
	if (out && typeof out === "object") {
		const o = out as Record<string, unknown>;
		if (typeof o.formatted_output === "string" && o.formatted_output) {
			return o.formatted_output;
		}
		const res = o.result as { content?: unknown } | null | undefined;
		const fromMcp = flattenAcpContent(res?.content);
		if (fromMcp) return fromMcp;
		if (typeof o.error === "string" && o.error) return o.error;
		if (o.error && typeof o.error === "object") {
			const m = (o.error as { message?: unknown }).message;
			if (typeof m === "string") return m;
		}
	}
	const term = (u._meta as { terminal_output?: { data?: unknown } } | undefined)
		?.terminal_output?.data;
	return typeof term === "string" ? term : "";
}

function ruleDenied(meta: unknown): boolean {
	return (
		(meta as { claudeCode?: { nonExecutionKind?: unknown } } | undefined)
			?.claudeCode?.nonExecutionKind === "permission-rule"
	);
}

/** The MCP server an ask's tool comes from, from Claude Code's `_meta` (#820). */
export function mcpServerOf(meta: unknown): string | null {
	const server = (
		meta as { claudeCode?: { mcpServer?: { name?: unknown } } } | undefined
	)?.claudeCode?.mcpServer?.name;
	return typeof server === "string" && server.trim() ? server.trim() : null;
}

/** The command an ask names, else the path; null when it names neither. */
export function askDetail(
	rawInput: unknown,
	locations?: { path?: string }[],
): string | null {
	const input = toArgs(rawInput);
	const command = input.command ?? input.cmd;
	const text =
		typeof command === "string"
			? command
			: Array.isArray(command) && command.every((c) => typeof c === "string")
				? command.join(" ")
				: [
						input.file_path,
						input.filePath,
						input.path,
						locations?.[0]?.path,
					].find((p): p is string => typeof p === "string" && p.length > 0);
	return text ? text.slice(0, ASK_DETAIL_LIMIT) : null;
}
