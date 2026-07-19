// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation, Agent Execution, and Tool Execution schemas
 */
import { z } from "zod";
import {
	AgentNameSchema,
	AgentTypeSchema,
	DateStringSchema,
	EvidenceDirectionSchema,
	EvidenceStatusSchema,
	ExecutionStatusSchema,
	HypothesisStatusSchema,
	RecommendationPrioritySchema,
	RootCauseCategorySchema,
	ToolCategorySchema,
	ToolExecutionStatusSchema,
	WorkflowStatusSchema,
} from "./common.js";
import { OverlaySchema } from "./overlay.js";

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

/**
 * The isolation-boundary slice of run-metadata (ADR-0020 Sandbox port + ADR-0017
 * honest fidelity): what the caller REQUESTED vs what boundary was ACTUALLY
 * obtained, plus its honest fidelity — the structured sibling of the
 * human-readable `mechanism` string on {@link RunFidelitySchema} (kept
 * consistent with it, never contradicting it).
 */
export const RunFidelitySandboxSchema = z.object({
	requested: z.string(),
	actual: z.string(),
	fidelity: z.enum(["enforced", "cooperative"]),
});
export type RunFidelitySandbox = z.infer<typeof RunFidelitySandboxSchema>;

/**
 * Run-metadata: the enforcement the harness actually applied (ADR-0017 honest
 * fidelity). Deterministic — computed from (harness, mode), never LLM-authored.
 */
export const RunFidelitySchema = z.object({
	harness: z.string(),
	mode: z.string(),
	fidelity: z.enum(["enforced", "cooperative", "advisory"]),
	mechanism: z.string(),
	/**
	 * The Sandbox boundary (ADR-0020) the harness was spawned into, when one was
	 * wired. Additive/optional — omitted when no sandbox applies (e.g. the
	 * in-process Agent SDK harness, or no boundary requested at all).
	 */
	sandbox: RunFidelitySandboxSchema.optional(),
});
export type RunFidelity = z.infer<typeof RunFidelitySchema>;

export const InvestigationReportSchema = z.object({
	summary: z.string().min(1),
	rootCause: z.string().nullable(),
	rootCauseCategory: RootCauseCategorySchema.nullable(),
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
});

// =============================================================================
// TOOL EXECUTION SCHEMAS
// =============================================================================

export const ToolExecutionSchema = z.object({
	id: z.string().uuid(),
	agentExecutionId: z.string().uuid(),
	toolName: z.string(),
	toolCategory: ToolCategorySchema.nullable(),
	arguments: z.record(z.unknown()).nullable(),
	result: z.record(z.unknown()).nullable(),
	status: ToolExecutionStatusSchema,
	executionTimeMs: z.number().int().nullable(),
	dataQuality: z.string().nullable(),
	error: z.string().nullable(),
	executedAt: DateStringSchema,
});

// =============================================================================
// AGENT EXECUTION SCHEMAS
// =============================================================================

export const AgentExecutionSchema = z.object({
	id: z.string().uuid(),
	investigationId: z.string().uuid(),
	agentName: AgentNameSchema,
	agentType: AgentTypeSchema,
	status: ExecutionStatusSchema,
	startedAt: DateStringSchema.nullable(),
	completedAt: DateStringSchema.nullable(),
	executionTimeMs: z.number().int().nullable(),
	output: z.record(z.unknown()).nullable(),
	inputTokens: z.number().int().nullable(),
	outputTokens: z.number().int().nullable(),
	error: z.string().nullable(),
	createdAt: DateStringSchema,
});

export const AgentExecutionWithToolsSchema = AgentExecutionSchema.extend({
	toolExecutions: z.array(ToolExecutionSchema).optional(),
});

// =============================================================================
// INVESTIGATION SCHEMAS
// =============================================================================

export const InvestigationSchema = z.object({
	id: z.string().uuid(),
	incidentId: z.string().uuid(),
	status: WorkflowStatusSchema,
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
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

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
	agentExecutions: z.array(AgentExecutionWithToolsSchema).optional(),
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

export type ToolExecution = z.infer<typeof ToolExecutionSchema>;
export type AgentExecution = z.infer<typeof AgentExecutionSchema>;
export type AgentExecutionWithTools = z.infer<
	typeof AgentExecutionWithToolsSchema
>;
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
});

export const CreateToolExecutionInputSchema = z.object({
	toolName: z.string(),
	toolCategory: z.string().optional(), // Using string directly to be permissive for inputs
	arguments: z.record(z.unknown()).nullable().optional(),
	result: z.record(z.unknown()).nullable().optional(),
	status: ToolExecutionStatusSchema.optional(),
	executionTimeMs: z.number().int().optional(),
	dataQuality: z.string().optional(),
	error: z.string().optional(),
});

export const CreateAgentExecutionInputSchema = z.object({
	agentName: z.string(),
	agentType: z.string().optional(),
	status: ExecutionStatusSchema.optional(),
	startedAt: z.string().datetime().optional(),
	completedAt: z.string().datetime().optional(),
	executionTimeMs: z.number().int().optional(),
	output: z.record(z.unknown()).optional(),
	inputTokens: z.number().int().optional(),
	outputTokens: z.number().int().optional(),
	error: z.string().optional(),
	toolExecutions: z.array(CreateToolExecutionInputSchema).optional(),
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
	agentExecutions: z.array(CreateAgentExecutionInputSchema).optional(),
	recommendations: z.array(CreateRecommendationInputSchema).optional(),
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
				args: z.record(z.unknown()),
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
				input_tokens: z.number().int().optional(),
				output_tokens: z.number().int().optional(),
			})
			.nullable()
			.optional(),
		total_cost_usd: z.number().optional(),
		modelUsage: z.record(z.unknown()).nullable().optional(),
		num_turns: z.number().int().optional(),
		duration_ms: z.number().int().optional(),
	}),
	z.object({
		kind: z.literal("error"),
		...StreamBaseShape,
		message: z.string(),
	}),
	z.object({
		kind: z.literal("report"),
		runId: z.string().uuid(),
		seq: z.number().int(),
		ts: z.string().datetime(),
		report: InvestigationReportSchema,
	}),
	z.object({
		kind: z.literal("llm_call"),
		runId: z.string().uuid(),
		seq: z.number().int(),
		ts: z.string().datetime(),
		phase: z.enum(["decompose", "map", "reduce"]),
		provider: z.string(),
		model: z.string(),
		usage: z
			.object({
				inputTokens: z.number().int().nullable(),
				outputTokens: z.number().int().nullable(),
			})
			.nullable(),
		latencyMs: z.number().int(),
		outcome: z.enum(["ok", "error"]),
		failureCause: z.string().nullable(),
	}),
]);

// ---- TYPE EXPORTS (ordered-evidence + canonical stream) ----
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type RuledOut = z.infer<typeof RuledOutSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;
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
	labels: z.record(z.string()),
	annotations: z.record(z.string()),
	startsAt: z.string().nullable(),
});
export type FiringAlert = z.infer<typeof FiringAlertSchema>;

/** Read-only telemetry + app endpoints the harness may query. */
export const TelemetryEndpointsSchema = z.object({
	prometheusUrl: z.string(),
	alertmanagerUrl: z.string(),
	apiUrl: z.string(),
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

/** A prior investigation summary — an episodic-memory seed (top-N similar past). */
export const PriorInvestigationSchema = z.object({
	incidentTitle: z.string().optional(),
	summary: z.string().optional(),
	rootCause: z.string().optional(),
});
export type PriorInvestigation = z.infer<typeof PriorInvestigationSchema>;

/**
 * The host-assembled investigation context (ADR-0015). `alerts` (≥1) + `telemetry`
 * are the always-present core; the rest are optional enrichments a richer host (the
 * app/cloud) supplies and the future context-pack (ADR-0016 §5) rides on. A later
 * per-alert fan-out needs no change here — the context is already 1..N.
 */
export const InvestigationContextSchema = z.object({
	/** ≥1 firing alert. A single-alert run is the degenerate case, not empty. */
	alerts: z.array(FiringAlertSchema).min(1),
	/** Read-only telemetry surfaces (resolved by the host — ADR-0011). */
	telemetry: TelemetryEndpointsSchema,
	incident: IncidentContextSchema.optional(),
	service: ServiceContextSchema.optional(),
	/** Repo slugs in play (owner/name); the harness cwd is the primary one. */
	repos: z.array(z.string()).optional(),
	logs: LogSystemContextSchema.optional(),
	priorInvestigations: z.array(PriorInvestigationSchema).optional(),
});
export type InvestigationContext = z.infer<typeof InvestigationContextSchema>;

/** Optional enrichments for the single-alert (CLI/degenerate) path. */
export interface SingleAlertContextExtras {
	incident?: IncidentContext;
	service?: ServiceContext;
	repos?: string[];
	logs?: LogSystemContext;
	priorInvestigations?: PriorInvestigation[];
}

/**
 * Build an InvestigationContext from ONE firing alert — the degenerate/CLI path.
 * The single place the "one alert → context" collapse lives (ADR-0015 §2); the
 * multi-alert app path assembles the context from its DB rows directly.
 */
export function singleAlertContext(
	alert: FiringAlert,
	telemetry: TelemetryEndpoints,
	extras: SingleAlertContextExtras = {},
): InvestigationContext {
	return {
		alerts: [alert],
		telemetry,
		...(extras.incident ? { incident: extras.incident } : {}),
		...(extras.service ? { service: extras.service } : {}),
		...(extras.repos ? { repos: extras.repos } : {}),
		...(extras.logs ? { logs: extras.logs } : {}),
		...(extras.priorInvestigations
			? { priorInvestigations: extras.priorInvestigations }
			: {}),
	};
}
