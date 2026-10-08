// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation, Agent Execution, and Tool Execution schemas
 */
import { HARNESS_IDS } from "@prismalens/config/harness";
import { z } from "zod";
import {
	DateStringSchema,
	EvidenceDirectionSchema,
	EvidenceStatusSchema,
	HypothesisStatusSchema,
	RecommendationPrioritySchema,
	RootCauseCategorySchema,
	ToolCategorySchema,
	WorkflowStatusSchema,
} from "./common.js";
import { type ContextPack, ContextPackSchema } from "./context-pack.js";
import { OverlaySchema } from "./overlay.js";
import {
	INVESTIGATION_KINDS,
	LIVE_TURNS,
	TURN_OUTCOMES,
} from "./state-semantics.js";

// =============================================================================
// ORDERED-EVIDENCE REPORT (ADR-0002) — no numeric confidence
// =============================================================================
// The structured investigation result. Supersedes the untyped `rawOutput` blob:
// ordered hypotheses + discrete evidence status carry certainty. Defined first so
// the persisted-result schemas below can reference it (eager z.object evaluation).

export const EvidenceSchema = z.object({
	/** What was observed. */
	observation: z.string().min(1),
	/** Where it came from — the exact command or origin that produced it. */
	source: z.string().min(1),
	direction: EvidenceDirectionSchema,
	status: EvidenceStatusSchema,
	/**
	 * Links a finding to the live tool call that produced it
	 * (StreamToolResult.toolCallId), so the report view can drill into the
	 * originating output (ADR-0007). Null for `inferred` evidence with no single
	 * originating call.
	 */
	toolCallId: z.string().nullable().optional(),
	/**
	 * Where this evidence came from. "tool" = a command/query the harness ran
	 * (the default and the only kind before the context pack). "context-pack" = a
	 * fact the HOST supplied (ADR-0016 §5) which the harness did not itself
	 * observe. Context-pack evidence is coerced to status "inferred" with a null
	 * toolCallId after synthesis — the model cannot promote a host fact to
	 * "verified" without re-observing it with a tool and citing that tool.
	 *
	 * NOTE: this field is a LABEL, not the trigger. The deterministic coercion
	 * keys off `source` matching the `context-pack:` prefix, because a model that
	 * simply OMITS `origin` must not thereby escape the coercion. Optional, not
	 * defaulted, so every persisted report already in the DB still parses;
	 * absent ⇒ treat as "tool".
	 */
	origin: z.enum(["tool", "context-pack"]).optional(),
});

export const HypothesisSchema = z.object({
	// Ordering is by ARRAY POSITION (most → least plausible) — the single source of
	// truth, per ADR-0002's "ordered list". No numeric rank/confidence.
	statement: z.string().min(1),
	status: HypothesisStatusSchema,
	evidence: z.array(EvidenceSchema),
});

export const RuledOutSchema = z.object({
	// A candidate cause never promoted to a ranked hypothesis. (A hypothesis that WAS
	// considered then disproved stays in `hypotheses` with status "refuted".)
	statement: z.string().min(1),
	why: z.string().min(1),
	/** The contradicting evidence that ruled it out (direction "contradicts"). */
	evidence: z.array(EvidenceSchema),
});

/** What was queried vs not — makes the investigation auditable (ADR-0002). */
export const CoverageSchema = z.object({
	queried: z.array(z.string()),
	notQueried: z.array(z.string()),
});

/**
 * A recommended next step (ADR-0002's "recommended next steps"). Carried inline so
 * the report delivered over the wire is self-contained; the persistence layer also
 * writes these as relational Recommendation rows.
 */
export const NextStepSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
	priority: RecommendationPrioritySchema.nullable().optional(),
});

/** Access levels stored before #673 w21; only the one with an exact agent mode word is renamed. */
const LEGACY_ACCESS_MODE: Record<string, string> = {
	"read-only-tools": "read-only",
};

/**
 * Run-metadata: the enforcement the harness actually applied (ADR-0017 honest
 * fidelity). Deterministic — computed from (harness, mode), never LLM-authored.
 */
export const RunFidelitySchema = z.object({
	harness: z.string(),
	/** The agent's own mode id the run ran in (#673 w21); records from #778 carry the old access level. */
	mode: z.preprocess((v) => LEGACY_ACCESS_MODE[v as string] ?? v, z.string()),
	fidelity: z.enum(["enforced", "cooperative", "advisory"]),
	mechanism: z.string(),
	/** The model id the run asked the harness for; absent when the harness chose its own. */
	model: z.string().optional(),
	/** Where that id came from (#337 run e, G11). Additive; older records have none. */
	modelSource: z
		.enum(["operator", "product-default", "harness-default", "env"])
		.optional(),
	/** ACP `initialize` `agentInfo.version`; absent when the harness did not report one. */
	harnessVersion: z.string().optional(),
	/** The model `session/new` reported as selected; absent when the harness reported none (#639). */
	servedModel: z.string().optional(),
	/** The effort the harness accepted over `session/set_config_option` (R4.2); absent when none was set. */
	effort: z.string().optional(),
});
export type RunFidelity = z.infer<typeof RunFidelitySchema>;

/** The run asked for one model and the harness reported another (#639). */
export function modelSubstituted(f: RunFidelity): boolean {
	return !!f.model && !!f.servedModel && f.model !== f.servedModel;
}

/**
 * Structured culprit identification (ADR-0026 / D3).
 * Identification only — no numeric confidence or ordering.
 */
export const CulpritSchema = z.object({
	/** The service the root cause lives in. */
	service: z.string().nullable().default(null),
	/** Deploy/commit/change-event reference. */
	changeRef: z.string().nullable().default(null),
	/** Short failure mechanism (e.g. "connection-pool exhaustion"). */
	mechanism: z.string().nullable().default(null),
});

export const InvestigationReportSchema = z.object({
	summary: z.string().min(1),
	rootCause: z.string().nullable(),
	rootCauseCategory: RootCauseCategorySchema.nullable(),
	/** Structured culprit sub-object (ADR-0026). All fields nullable; whole object optional. */
	culprit: CulpritSchema.nullable().optional(),
	/** Ordered most → least plausible (array order is the ordering). */
	hypotheses: z.array(HypothesisSchema),
	ruledOut: z.array(RuledOutSchema),
	coverage: CoverageSchema,
	nextSteps: z.array(NextStepSchema),
	/**
	 * Run-metadata, ADR-0017 honest fidelity — the enforcement the harness
	 * actually applied. Attached deterministically after synthesis; never
	 * LLM-generated.
	 */
	fidelity: RunFidelitySchema.nullable().optional(),
	/**
	 * Content in the input that attempted to instruct the model rather than
	 * inform it (#207). The correct response to an injection attempt is to
	 * IGNORE the instruction, CONTINUE the investigation, and RECORD it here —
	 * never to silently drop it. Absent/empty = nothing flagged.
	 *
	 * Unlike `fidelity` (deterministic, stamped post-synthesis), this one IS
	 * LLM-authored — only the model can notice an instruction attempt.
	 */
	flaggedContent: z
		.array(
			z.object({
				where: z.enum(["context-pack", "tool-output"]),
				/**
				 * The offending text, quoted and HARD-capped at 120 chars.
				 * DANGER: this is a schema-blessed channel for copying an
				 * attacker's payload verbatim into the NEXT model call (the
				 * reduce merge serializes whole branch reports). The cap is the
				 * first half of the mitigation; the sanitize-and-fence at the
				 * merge boundary (synthesize.ts `mergePrompt`) is the second.
				 * Never widen this cap.
				 */
				quote: z.string().max(120),
				/** Why it was flagged — the model's own words, not the attacker's. */
				why: z.string().max(300),
			}),
		)
		.max(10)
		.optional(),
});

// =============================================================================
// INVESTIGATION SCHEMAS
// =============================================================================

/** One repository a run's workspace holds (#747). */
export const RunWorkspaceRepoSchema = z.object({
	/** Folder name under `repos/`, or "repo" for the single layout. */
	name: z.string(),
	/** Absolute clone path. */
	dir: z.string(),
	sourceKind: z.enum(["folder", "url"]),
	url: z.string(),
	subPath: z.string().nullable(),
	connectionId: z.string().nullable(),
	/** Full commit sha the run saw. */
	head: z.string(),
	branch: z.string().nullable(),
	/** Service names that link this repo. */
	services: z.array(z.string()),
});
export type RunWorkspaceRepo = z.infer<typeof RunWorkspaceRepoSchema>;

/** Where a run's harness worked, recorded so a follow-up can rebuild it (#747). */
export const RunWorkspaceSchema = z.object({
	layout: z.enum(["unmapped", "single", "multi"]),
	cwd: z.string(),
	repos: z.array(RunWorkspaceRepoSchema),
});
export type RunWorkspace = z.infer<typeof RunWorkspaceSchema>;

export const InvestigationKindSchema = z.enum(INVESTIGATION_KINDS);

export const InvestigationSchema = z.object({
	id: z.string().uuid(),
	incidentId: z.string().uuid(),
	status: WorkflowStatusSchema,
	/** A run is a thread (#673): the alert workflow, or a chat a message started. */
	kind: InvestigationKindSchema.optional().default("investigation"),
	/** The agent's own mode id the run asked for; `agent-default` asked for none. */
	agentMode: z.string().nullable().optional(),
	/** Investigation: the brief's first line; chat: the message's first 120 characters. */
	title: z.string().nullable().optional(),
	/** The run left a report; a chat never does. */
	hasReport: z.boolean().optional(),
	startedAt: DateStringSchema.nullable(),
	completedAt: DateStringSchema.nullable(),
	summary: z.string().nullable(),
	rootCause: z.string().nullable(),
	rootCauseCategory: RootCauseCategorySchema.nullable(),
	/** The full ordered-evidence report (ADR-0002); supersedes the old confidence/dataQuality/rawOutput columns. */
	report: InvestigationReportSchema.nullable().optional(),
	/**
	 * App-side reduce overlay (ADR-0016 §5c) — post-report enrichment computed
	 * BESIDE the canonical report (related changes, service-graph proximity, similar
	 * incidents). Absent until computed; the engine never sees it (ADR-0011).
	 */
	overlay: OverlaySchema.nullable().optional(),
	error: z.string().nullable(),
	/** The harness and model the run started with; the report's fidelity says what actually ran (#743). */
	harness: z.string().nullable().optional(),
	model: z.string().nullable().optional(),
	/** The effort the run asked for (#673 w52); null asked for the agent's own. */
	effort: z.string().nullable().optional(),
	/** Set when the operator asked the run to stop, so Stopping survives a reload. */
	stopRequestedAt: DateStringSchema.nullable().optional(),
	/** What the live turn owes (#673 w59); null when nothing runs, or a legacy claim. */
	liveTurn: z.enum(LIVE_TURNS).nullable().optional(),
	/** How the last follow-up ended; null until one has (#673 w59). */
	lastTurnOutcome: z.enum(TURN_OUTCOMES).nullable().optional(),
	/** The harness's own session id, kept only when it can be loaded again (#747). */
	acpSessionId: z.string().nullable().optional(),
	workspace: RunWorkspaceSchema.nullable().optional(),
	/** A finished run whose session a follow-up message can continue. */
	resumable: z.boolean().optional(),
	/** Why a finished run cannot be continued; null when it can. */
	resumeBlockedReason: z.string().nullable().optional(),
	/** A reportless stopped or failed investigation whose session reopens to a report (R4.4, #673 w59). */
	continuable: z.boolean().optional(),
	/** That mode's name as the agent's last readiness check listed it; the id when it listed none. */
	agentModeName: z.string().nullable().optional(),
	/** Record identity origin stamp (ADR-0026). Optional, defaults to "local". */
	origin: z.string().optional().default("local"),
	/** Persisted schema version (ADR-0026). Optional, defaults to 1. */
	schemaVersion: z.number().int().optional().default(1),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

/** A completed report rendered as Markdown for download (#606). */
export const InvestigationReportMarkdownSchema = z.object({
	filename: z.string(),
	markdown: z.string(),
});

export const GITHUB_ISSUE_OR_PR_URL =
	/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)$/;
export const PostReportToGitHubSchema = z.object({
	id: z.string().uuid(),
	target: z
		.string()
		.trim()
		.regex(
			GITHUB_ISSUE_OR_PR_URL,
			"Must be a https://github.com/<owner>/<repo>/issues/<n> or /pull/<n> URL",
		),
});
export const PostReportToGitHubResultSchema = z.object({
	commentUrl: z.string().url(),
});

export type PostReportToGitHubInput = z.infer<typeof PostReportToGitHubSchema>;
export type PostReportToGitHubResult = z.infer<
	typeof PostReportToGitHubResultSchema
>;

export const CreateInvestigationSchema = z.object({
	incidentId: z.string().uuid(),
});

// =============================================================================
// INVESTIGATION WITH RELATIONS
// =============================================================================

// Recommendation reference (minimal)
const RecommendationRefSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	priority: z.string(),
	status: z.string(),
});

export const InvestigationWithRelationsSchema = InvestigationSchema.extend({
	recommendations: z.array(RecommendationRefSchema).optional(),
});

// =============================================================================
// INVESTIGATION STATUS (includes job queue info)
// =============================================================================

export const InvestigationStatusSchema = z.object({
	investigation: InvestigationSchema,
	job: z
		.object({
			id: z.string(),
			state: z.string(),
			progress: z.number().min(0).max(100).nullable(),
			attemptsMade: z.number().int(),
			failedReason: z.string().nullable(),
		})
		.nullable(),
});

// =============================================================================
// INVESTIGATION QUERY SCHEMAS
// =============================================================================

export const InvestigationQuerySchema = z.object({
	incidentId: z.string().uuid().optional(),
	status: WorkflowStatusSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Investigation = z.infer<typeof InvestigationSchema>;
export type CreateInvestigationInput = z.infer<
	typeof CreateInvestigationSchema
>;
export type InvestigationWithRelations = z.infer<
	typeof InvestigationWithRelationsSchema
>;
export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;
export type InvestigationQuery = z.infer<typeof InvestigationQuerySchema>;

// =============================================================================
// WORKER INPUT SCHEMAS
// =============================================================================

export const UpdateInvestigationStatusSchema = z.object({
	id: z.string().uuid(),
	status: WorkflowStatusSchema,
	error: z.string().optional(),
	harnessThreadId: z.string().uuid().optional(),
	/** Not a uuid: OpenCode session ids are `ses_…` (#747). */
	acpSessionId: z.string().min(1).max(200).optional(),
	/** JSON {@link RunWorkspace}. */
	workspace: z.string().optional(),
});

export const CreateRecommendationInputSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	priority: z.string().optional(), // 'low' | 'medium' | 'high' | 'critical'
	category: z.string().optional(),
	urgency: z.string().optional(),
	actionable: z.boolean().optional(),
	estimatedEffort: z.string().optional(),
});

export const WriteInvestigationResultSchema = z.object({
	id: z.string().uuid(),
	status: WorkflowStatusSchema,
	summary: z.string().optional(),
	rootCause: z.string().optional(),
	rootCauseCategory: z.string().optional(),
	/** The full ordered-evidence report (ADR-0002), persisted as Investigation.report. */
	report: InvestigationReportSchema.optional(),
	error: z.string().optional(),
	recommendations: z.array(CreateRecommendationInputSchema).optional(),
	origin: z.string().optional(),
	schemaVersion: z.number().int().optional(),
});

// =============================================================================
// CANONICAL INVESTIGATION STREAM (harness-agnostic)
// =============================================================================
// The adapter normalises each rented harness's native events into this ONE
// vocabulary (ADR-0008), superseding the LangGraph `[mode, data]` tuple stream.
// Drill-down tree: branch → node (`path`) → tool call. Slice 0 is a single
// branch; fan-out (Slice 1) varies `branchId` and reuses this shape unchanged.

/** Normalised tool-call provenance — one harness tool call (OpenSRE evidence model). */
export const StreamToolResultSchema = z.object({
	/** Tool name — same key as the originating agent_step `toolCalls[].name`. */
	name: z.string().min(1),
	toolCategory: ToolCategorySchema.nullable().optional(),
	/** Links this result to its call. Derive from ToolMessage.tool_call_id. */
	toolCallId: z.string(),
	/** The command/args that produced it (human-readable provenance). */
	source: z.string().min(1),
	/**
	 * Derive from ToolMessage.status === "error" (NOT from "on_tool_end fired" —
	 * LangGraph ToolNode has handleToolErrors=true and emits a failed tool as a
	 * normal end event with status "error"; MCP tools may return error-as-content).
	 */
	ok: z.boolean(),
	/** Failure message when !ok, for the drill-down. */
	error: z.string().nullable().optional(),
	/** Truncated/sanitised result. */
	preview: z.string(),
});

const StreamBaseShape = {
	runId: z.string().uuid(),
	/**
	 * Slice 0: a single constant branch. Fan-out (Slice 1) varies it. The UI's
	 * ordering + idempotent-upsert key is (branchId, seq) — NOT seq alone, since each
	 * branch is a separate harness run with its own counter.
	 */
	branchId: z.string().min(1),
	/**
	 * Structural nesting depth within a branch, from the harness checkpoint ns
	 * (LangGraph node names + task uuids; the `tools:` wrapper collapsed). These are
	 * NOT subagent names — see `label` for the human name. [] = branch top.
	 */
	path: z.array(z.string()),
	/** Per-branch monotonic sequence (adapter-assigned in arrival order). */
	seq: z.number().int(),
	/**
	 * Human-readable node/subagent label when resolvable (from the spawning `task`
	 * tool-call's subagent_type via run_id parentage); null at the branch top.
	 */
	label: z.string().nullable().optional(),
	/** Wall-clock emit time (adapter-stamped) for step/tool durations in the drill-down. */
	ts: z.string().datetime(),
};

/** How an operator message reaches a live run: at its next pause, or now. */
export const OperatorMessageModeSchema = z.enum(["queue", "now"]);
export type OperatorMessageMode = z.infer<typeof OperatorMessageModeSchema>;

/** At most this many files ride on one message (R4.3). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const AttachmentIdsSchema = z
	.array(z.string().uuid())
	.max(MAX_ATTACHMENTS_PER_MESSAGE);

/**
 * The box's chips for one run (#673 w52): each absent field falls back to Settings,
 * and `null` asks for the agent's own default. The 1M window rides in `model` as `[1m]`.
 */
export const RunChoiceSchema = z.object({
	harness: z.enum(HARNESS_IDS).optional(),
	model: z.string().min(1).max(256).nullable().optional(),
	effort: z.string().min(1).max(64).nullable().optional(),
});
export type RunChoice = z.infer<typeof RunChoiceSchema>;

/** A file the operator attached, as the conversation shows it under its message. */
export const AttachmentRefSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	mimeType: z.string(),
	size: z.number().int().min(0),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

/** `chat` asks a follow-up; `continue` takes a stopped run on to its report (R4.4). */
export const FollowUpKindSchema = z.enum(["chat", "continue"]);
export type FollowUpKind = z.infer<typeof FollowUpKindSchema>;

/** Body of `POST /investigations/{id}/messages`. */
export const SendInvestigationMessageSchema = z.object({
	text: z.string().trim().min(1).max(4000),
	/** Only the constant `run` branch exists until fan-out lands (#280). */
	branchId: z.string().min(1).optional(),
	mode: OperatorMessageModeSchema.default("queue"),
	/** What the message asks for; on a live run it must match the live turn (#673 w59). */
	kind: FollowUpKindSchema.optional(),
	/** Uploaded with `POST /incidents/{id}/attachments` first. */
	attachments: AttachmentIdsSchema.optional(),
});
export type SendInvestigationMessageInput = z.infer<
	typeof SendInvestigationMessageSchema
>;

export const SendInvestigationMessageResultSchema = z.object({
	/** `resumed`: the run had finished and a follow-up reopened its session (#747). */
	state: z.enum(["queued", "sent", "resumed"]),
});
export type SendInvestigationMessageResult = z.infer<
	typeof SendInvestigationMessageResultSchema
>;

export const CanonicalEventSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("agent_step"),
		...StreamBaseShape,
		text: z.string(),
		toolCalls: z.array(
			z.object({
				/** Stable id from AIMessage tool_calls[].id; pairs with a tool_result. */
				toolCallId: z.string(),
				name: z.string().min(1),
				/** Post-unwrap args (the deepagents {input:"<json>"} wrapper removed). */
				args: z.record(z.string(), z.unknown()),
			}),
		),
	}),
	z.object({
		kind: z.literal("tool_result"),
		...StreamBaseShape,
		result: StreamToolResultSchema,
	}),
	z.object({
		kind: z.literal("branch_done"),
		...StreamBaseShape,
		/**
		 * Supervisor classification (not a harness field). The adapter maps a thrown
		 * GraphRecursionError to "budget"; genuine failures emit an `error` event.
		 */
		reason: z.enum(["submitted", "budget", "no_progress"]),
		usage: z
			.object({
				input_tokens: z.number().int().min(0).optional(),
				output_tokens: z.number().int().min(0).optional(),
			})
			.nullable()
			.optional(),
		total_cost_usd: z.number().min(0).optional(),
		modelUsage: z.record(z.string(), z.unknown()).nullable().optional(),
		num_turns: z.number().int().min(0).optional(),
		duration_ms: z.number().int().min(0).optional(),
	}),
	z.object({
		kind: z.literal("error"),
		...StreamBaseShape,
		message: z.string(),
	}),
	z.object({
		/**
		 * Text the operator sent to the running session (#743). `queue` waits for
		 * the agent's next pause, `now` cancels its current step. `delivered:false`
		 * means the run ended before the message reached the agent.
		 */
		kind: z.literal("operator_message"),
		...StreamBaseShape,
		text: z.string(),
		mode: OperatorMessageModeSchema,
		delivered: z.boolean(),
		/** Only on a follow-up's first message: the repos it was rebuilt at (#747). */
		resumed: z
			.array(z.object({ name: z.string(), head: z.string() }))
			.optional(),
		/** Files that went with the message (R4.3). */
		attachments: z.array(AttachmentRefSchema).optional(),
	}),
	z.object({
		/** The harness answered `session/set_config_option` before the first prompt (R4.2). */
		kind: z.literal("session_config"),
		...StreamBaseShape,
		option: z.enum(["model", "effort"]),
		value: z.string(),
		accepted: z.boolean(),
	}),
	z.object({
		kind: z.literal("report"),
		runId: z.string().uuid(),
		seq: z.number().int(),
		ts: z.string().datetime(),
		report: InvestigationReportSchema,
	}),
]);

// ---- TYPE EXPORTS (ordered-evidence + canonical stream) ----
export type Evidence = z.infer<typeof EvidenceSchema>;
export type InvestigationReportMarkdown = z.infer<
	typeof InvestigationReportMarkdownSchema
>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type RuledOut = z.infer<typeof RuledOutSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;
export type Culprit = z.infer<typeof CulpritSchema>;
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;
export type StreamToolResult = z.infer<typeof StreamToolResultSchema>;
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

// =============================================================================
// DURABLE EVENT RECORD (ADR-0018 store.append) — bulk-append + replay/history
// =============================================================================
// The worker's durable STORE persists every CanonicalEvent to InvestigationEvent
// rows (batched). These schemas cover the wire shapes: the internal bulk-append
// payload (validated per-event, invalid ones dropped) and the public replay page.

/**
 * The sentinel `branchId` under which the terminal `report` event — the one
 * CanonicalEvent kind that carries no `branchId` — is stored, so the durable
 * record's idempotency key `(investigationId, branchId, seq)` stays well-defined
 * for every event kind.
 */
export const INVESTIGATION_REPORT_BRANCH = "__report__";

/** The internal bulk-append body — a batch of raw events, each validated per-item. */
export const AppendInvestigationEventsSchema = z.object({
	events: z.array(z.unknown()),
});
export type AppendInvestigationEventsInput = z.infer<
	typeof AppendInvestigationEventsSchema
>;

/** The internal bulk-append result — how many rows were accepted vs dropped. */
export const AppendInvestigationEventsResultSchema = z.object({
	accepted: z.number().int(),
	dropped: z.number().int(),
});
export type AppendInvestigationEventsResult = z.infer<
	typeof AppendInvestigationEventsResultSchema
>;

/**
 * Query for the public replay/history endpoint — paginate by a `seq` cursor
 * (exclusive: rows with `seq > cursor`). Combined with the `:id` path param.
 */
export const GetInvestigationEventsSchema = z.object({
	id: z.string().uuid(),
	/** Exclusive `seq` cursor; omit for the first page. */
	cursor: z.coerce.number().int().min(0).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type GetInvestigationEventsInput = z.infer<
	typeof GetInvestigationEventsSchema
>;

/**
 * A page of durable canonical events (parsed back through the schema on the way
 * OUT). `nextCursor` is the `seq` to pass as the next query's `cursor`, or null at
 * the end of the record.
 */
export const InvestigationEventsPageSchema = z.object({
	events: z.array(CanonicalEventSchema),
	nextCursor: z.number().int().nullable(),
});
export type InvestigationEventsPage = z.infer<
	typeof InvestigationEventsPageSchema
>;

// ENGINE INVESTIGATION INPUTS (ADR-0008) — the seed alert + telemetry surfaces

/** A firing alert, normalised from the Alertmanager v2 API. */
export const FiringAlertSchema = z.object({
	alertname: z.string(),
	severity: z.string().nullable(),
	labels: z.record(z.string(), z.string()),
	annotations: z.record(z.string(), z.string()),
	startsAt: z.string().nullable(),
});
export type FiringAlert = z.infer<typeof FiringAlertSchema>;

/** Read-only telemetry + app endpoints the harness may query. */
export const TelemetryEndpointsSchema = z.object({
	prometheusUrl: z.string().optional(),
	alertmanagerUrl: z.string().optional(),
	apiUrl: z.string().optional(),
});
export type TelemetryEndpoints = z.infer<typeof TelemetryEndpointsSchema>;

// =============================================================================
// ENGINE INVESTIGATION CONTEXT (ADR-0015) — the host-assembled input contract
// =============================================================================
// The ONE domain payload the Tier-1 supervisor consumes (ADR-0016). An incident-
// shaped SUPERSET: a single-alert CLI run is the DEGENERATE case (one alert), NOT
// context-free — it still carries the repo/service/telemetry/logs the host knows
// from `prismalens.config.yaml`. These are engine-local PROJECTIONS: deliberately
// lifecycle-field-free (no id/number/status/assignee/MTTx) and NOT the DB
// Alert/Incident/Service schemas (ADR-0011 keeps the engine db-clean).

/** Incident meta for framing — no lifecycle fields. */
export const IncidentContextSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	severity: z.string().optional(),
	startedAt: z.string().optional(),
});
export type IncidentContext = z.infer<typeof IncidentContextSchema>;

/** The affected service projection — identity + a blast-radius seed. */
export const ServiceContextSchema = z.object({
	name: z.string().min(1),
	tier: z.string().optional(),
	/** owner/name slug or a local path — where the harness reads the code. */
	repo: z.string().optional(),
	/** Direct dependency names (blast-radius seed for a future reduce overlay). */
	dependsOn: z.array(z.string()).optional(),
});
export type ServiceContext = z.infer<typeof ServiceContextSchema>;

/** A read-only log-query system the harness may curl (Loki, Elasticsearch, …). */
export const LogSystemContextSchema = z.object({
	kind: z.string().optional(),
	url: z.string().optional(),
});
export type LogSystemContext = z.infer<typeof LogSystemContextSchema>;

/**
 * A prior investigation summary — an episodic-memory seed (top-N similar past).
 *
 * Superseded in practice by `contextPack.priorIncidents`, which carries the same
 * intent with a fence, a rank, and an honest `matchedOn`. Retained because ADR-0015
 * names this field in the host->engine contract and that contract is EXTEND-ONLY:
 * removing it is a breaking narrowing, not a cleanup, even while no host populates
 * it and no stage reads it. Retire it via an ADR-0015 amendment, not a diff.
 */
export const PriorInvestigationSchema = z.object({
	incidentTitle: z.string().optional(),
	summary: z.string().optional(),
	rootCause: z.string().optional(),
});
export type PriorInvestigation = z.infer<typeof PriorInvestigationSchema>;

/**
 * The host-assembled investigation context (ADR-0015). `alerts` (≥1) + `telemetry`
 * are the always-present core; the rest are optional enrichments a richer host (the
 * app/cloud) supplies, and the context-pack (ADR-0016 §5) rides on. A later
 * per-alert fan-out needs no change here — the context is already 1..N.
 */
export const InvestigationContextSchema = z.object({
	/** ≥1 firing alert. A single-alert run is the degenerate case, not empty. */
	alerts: z.array(FiringAlertSchema).min(1),
	/** Read-only telemetry surfaces, only when the host has them configured (ADR 0002 §2). */
	telemetry: TelemetryEndpointsSchema.optional(),
	incident: IncidentContextSchema.optional(),
	service: ServiceContextSchema.optional(),
	/** Repo slugs in play (owner/name); the harness cwd is the primary one. */
	repos: z.array(z.string()).optional(),
	logs: LogSystemContextSchema.optional(),
	priorInvestigations: z.array(PriorInvestigationSchema).optional(),
	/**
	 * Host-assembled facts the harness cannot reach by iterating (ADR-0016 §5).
	 * Absent on the CLI/degenerate path and on any host that could not assemble
	 * one — the engine renders nothing and behaves exactly as before.
	 */
	contextPack: ContextPackSchema.optional(),
	/** Several repos under the cwd; `path` is relative to it, e.g. `api/` (#747). */
	workspace: z
		.object({
			repos: z.array(
				z.object({
					path: z.string(),
					services: z.array(z.string()),
					subPath: z.string().nullable(),
					head: z.string(),
				}),
			),
		})
		.optional(),
});
export type InvestigationContext = z.infer<typeof InvestigationContextSchema>;

/** Optional enrichments applied when assembling an InvestigationContext. */
export interface InvestigationContextExtras {
	incident?: IncidentContext;
	service?: ServiceContext;
	repos?: string[];
	logs?: LogSystemContext;
	priorInvestigations?: PriorInvestigation[];
	contextPack?: ContextPack;
}

/**
 * Build an InvestigationContext from N correlated firing alerts belonging to ONE
 * incident.
 *
 * `alerts` has always been `.min(1)` rather than exactly-one, but until now the
 * only builder was {@link singleAlertContext}, which hardcodes a single-element
 * array — a storm was expressible in the contract and not constructible in code.
 * Scenarios whose entire discrimination axis is grouping a storm into one
 * incident (sreforge#65) could not be driven at all.
 *
 * The app still assembles its context from DB rows. This is the collapse for
 * hosts holding alerts in memory (the CLI, the eval harness), and it is where the
 * "alerts → context" shape now lives once (ADR-0015 §2).
 */
export function correlatedAlertsContext(
	alerts: readonly FiringAlert[],
	telemetry: TelemetryEndpoints | undefined,
	extras: InvestigationContextExtras = {},
): InvestigationContext {
	// The schema's `.min(1)` would reject this downstream; throwing here names the
	// actual mistake instead of surfacing it as a validation error far from source.
	if (alerts.length === 0) {
		throw new Error(
			"correlatedAlertsContext: at least one firing alert is required",
		);
	}
	return {
		alerts: [...alerts],
		...(telemetry ? { telemetry } : {}),
		...(extras.incident ? { incident: extras.incident } : {}),
		...(extras.service ? { service: extras.service } : {}),
		...(extras.repos ? { repos: extras.repos } : {}),
		...(extras.logs ? { logs: extras.logs } : {}),
		...(extras.priorInvestigations
			? { priorInvestigations: extras.priorInvestigations }
			: {}),
		...(extras.contextPack ? { contextPack: extras.contextPack } : {}),
	};
}

/**
 * Build an InvestigationContext from ONE firing alert — the degenerate/CLI path
 * (ADR-0012: the CLI is single-alert; incidents are an app/cloud feature).
 */
export function singleAlertContext(
	alert: FiringAlert,
	telemetry: TelemetryEndpoints | undefined,
	extras: InvestigationContextExtras = {},
): InvestigationContext {
	return correlatedAlertsContext([alert], telemetry, extras);
}

// =============================================================================
// INVESTIGATION QUEUE JOB DATA SCHEMAS
// =============================================================================

/** An attachment as a job carries it: a path the run reads, never the bytes (R4.3). */
export const JobAttachmentSchema = AttachmentRefSchema.extend({
	path: z.string(),
});
export type JobAttachment = z.infer<typeof JobAttachmentSchema>;

export const InvestigationJobDataSchema = z.object({
	incidentId: z.string(),
	investigationId: z.string(),
	priority: z.enum(["low", "normal", "high", "critical"]).optional(),
	context: z.record(z.string(), z.unknown()).optional(),
	connectionIds: z.array(z.string()).optional(),
	alerts: z.array(FiringAlertSchema).optional(),
	/** The operator's brief for the agent (#743). */
	brief: z.string().max(4000).optional(),
	/** The agent's own mode id (#673 w21); the agent's row default when absent, a queued legacy job included. */
	agentMode: z.string().max(64).optional(),
	...RunChoiceSchema.shape,
	/** Files that go with the brief, as the host stored them (R4.3). */
	attachments: z.array(JobAttachmentSchema).optional(),
	/** `chat`: a conversation `chat.text` started; it ends with no report (#673). */
	kind: InvestigationKindSchema.optional(),
	chat: z
		.object({
			text: z.string().min(1).max(4000),
			attachments: z.array(JobAttachmentSchema).optional(),
		})
		.optional(),
	/** A follow-up on a finished run: reopen its session and send this (#747). */
	resume: z
		.object({
			text: z.string().min(1).max(4000),
			mode: OperatorMessageModeSchema,
			/** `continue` takes a stopped run on to its report (R4.4); `chat` when absent. */
			kind: FollowUpKindSchema.optional(),
			attachments: z.array(JobAttachmentSchema).optional(),
			/** A continued run already ran a tool before it was stopped. */
			sawEvidence: z.boolean().optional(),
			/** What the row said before the follow-up; a follow-up never changes it. */
			restore: z.object({
				status: WorkflowStatusSchema,
				completedAt: z.string().nullable(),
				error: z.string().nullable(),
			}),
		})
		.optional(),
});

export type InvestigationJobData = z.infer<typeof InvestigationJobDataSchema>;

/** Map an alert object or DB alert row into a FiringAlert projection. */
export function toFiringAlert(row: Record<string, unknown>): FiringAlert {
	const rawLabels = row.labels;
	let labels: Record<string, string> = {};
	if (typeof rawLabels === "string") {
		try {
			labels = JSON.parse(rawLabels) as Record<string, string>;
		} catch {
			labels = {};
		}
	} else if (rawLabels && typeof rawLabels === "object") {
		labels = rawLabels as Record<string, string>;
	}

	const rawAnnotations = row.annotations;
	let annotations: Record<string, string> = {};
	if (typeof rawAnnotations === "string") {
		try {
			annotations = JSON.parse(rawAnnotations) as Record<string, string>;
		} catch {
			annotations = {};
		}
	} else if (rawAnnotations && typeof rawAnnotations === "object") {
		annotations = { ...(rawAnnotations as Record<string, string>) };
	}

	if (row.description && !annotations.summary && !annotations.description) {
		annotations.summary = String(row.description);
	}

	const rawStartsAt = row.triggeredAt ?? row.startsAt ?? null;
	const startsAt =
		rawStartsAt instanceof Date
			? rawStartsAt.toISOString()
			: typeof rawStartsAt === "string"
				? rawStartsAt
				: null;

	return {
		alertname: (row.title as string) ?? (row.alertname as string) ?? "Alert",
		severity: (row.severity as string) ?? labels.severity ?? null,
		labels,
		annotations,
		startsAt,
	};
}
