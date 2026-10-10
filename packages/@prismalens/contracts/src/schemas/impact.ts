// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The incident overview's Impact chart and its "Stop the impact" options (#811).
 * Query results are returned live and never stored (ADR 0006 §1).
 */
import { z } from "zod";
import { IncidentChangeSchema } from "./change-event.js";
import { DateStringSchema, RecommendationPrioritySchema } from "./common.js";
import { NextStepKindSchema } from "./investigation.js";

/** The `ServiceIntegration.config` key that holds a service's own PromQL metric (Q2b): chart fallback only, never a fix check. */
export const SERVICE_METRIC_CONFIG_KEY = "metric";

export const ComparisonOpSchema = z.enum(["==", "!=", ">", "<", ">=", "<="]);
export type ComparisonOp = z.infer<typeof ComparisonOpSchema>;

export const ThresholdSchema = z.object({
	/** The operator as the alert reads it with the series on the left: `series > value` fires. */
	op: ComparisonOpSchema,
	value: z.number(),
});
export type Threshold = z.infer<typeof ThresholdSchema>;

/**
 * Where the alert's expression came from. recovered: the rule's own expression, sent with the alert.
 * recovered_current_rule: a catch-up alert matched exactly one rule loaded now (chart only; it may have changed).
 * expression_unknown: no expression can be trusted. not_configured: no Prometheus to ask.
 */
export const ExpressionStateSchema = z.enum([
	"recovered",
	"recovered_current_rule",
	"expression_unknown",
	"not_configured",
]);
export type ExpressionState = z.infer<typeof ExpressionStateSchema>;

export const ImpactSeriesSchema = z.object({
	labels: z.record(z.string(), z.string()),
	/** [unix seconds, value]; null where Prometheus answered NaN or Inf. */
	points: z.array(z.tuple([z.number(), z.number().nullable()])),
});

export const ImpactQuerySchema = z.object({ id: z.string().uuid() });

export const ImpactChartSchema = z.object({
	incidentId: z.string().uuid(),
	/** The alert the chart is about: the newest firing one, else the newest. */
	alertId: z.string().uuid().nullable(),
	/**
	 * ok: series to draw. not_configured: no Prometheus connection ("Connect Prometheus").
	 * expression_unknown: alert history and link-out only, unless `metric.source` is "service".
	 * too_broad: 50 or more series, or over 2 MB; link-out only. timeout: no answer within 10 s (Try again).
	 * error: Prometheus refused the query.
	 */
	state: z.enum([
		"ok",
		"not_configured",
		"expression_unknown",
		"too_broad",
		"timeout",
		"error",
	]),
	expression: z.object({
		state: ExpressionStateSchema,
		/** Why it is unknown, in words for the card ("the rule is no longer loaded", "3 rules share this name"). */
		reason: z.string().nullable(),
	}),
	/** What is charted; null when nothing is. A "service" metric is the service's, not this alert's. */
	metric: z
		.object({
			source: z.enum(["alert", "alert_current_rule", "service"]),
			query: z.string(),
			threshold: ThresholdSchema.nullable(),
		})
		.nullable(),
	scope: z.object({
		/** scoped: this alert's one series. several: N series match it. unscoped: the rule could not be matched on this Prometheus. */
		state: z.enum(["scoped", "several", "unscoped"]),
		matched: z.number().int(),
	}),
	series: z.array(ImpactSeriesSchema),
	window: z.object({ start: DateStringSchema, end: DateStringSchema }),
	stepSeconds: z.number().int(),
	/** Latest value and the median before the alert fired; only for one scoped series. */
	now: z.number().nullable(),
	usual: z.number().nullable(),
	deploys: z.array(IncidentChangeSchema),
	history: z.object({
		firingSince: DateStringSchema.nullable(),
		resolvedAt: DateStringSchema.nullable(),
		alertCount: z.number().int(),
		/** Earlier episodes of the same alert in the last 7 days. */
		refiresThisWeek: z.number().int(),
		/** Firing spans of this alert in the last 7 days, oldest first; `end` null while firing. */
		strip: z.array(
			z.object({ start: DateStringSchema, end: DateStringSchema.nullable() }),
		),
	}),
	/** The alert's own link (its sender's graph page); never fetched by the server. */
	linkOut: z.string().nullable(),
	connection: z.object({ id: z.string(), label: z.string() }).nullable(),
	error: z.string().nullable(),
	capturedAt: DateStringSchema,
});
export type ImpactChart = z.infer<typeof ImpactChartSchema>;

// =============================================================================
// FIX OPTIONS ("Stop the impact")
// =============================================================================

/** Below the alert threshold is not "It worked": only the alert resolving says that. */
export const FixVerdictSchema = z.enum([
	"not_yet",
	"below_threshold",
	"could_not_check",
	"it_worked",
]);
export type FixVerdict = z.infer<typeof FixVerdictSchema>;

export const FixCheckReasonSchema = z.enum([
	"no-connection",
	"expression-unknown",
	"current-rule",
	"unsupported-shape",
	"range-function",
	"rule-not-matched",
	"series-not-scoped",
	"too-broad",
	"no-value",
	"timeout",
	"error",
]);
export type FixCheckReason = z.infer<typeof FixCheckReasonSchema>;

export const FixOptionSchema = z.object({
	/** The stamped id; null on a report written before ids, which is read-only. */
	id: z.string().uuid().nullable(),
	/** Rank: the option's place in the report. */
	index: z.number().int(),
	kind: NextStepKindSchema,
	title: z.string(),
	detail: z.string(),
	command: z.string().nullable(),
	facts: z.array(z.string()),
	priority: RecommendationPrioritySchema.nullable(),
	readOnly: z.boolean(),
	appliedAt: DateStringSchema.nullable(),
	lastCheck: z
		.object({ verdict: FixVerdictSchema, at: DateStringSchema })
		.nullable(),
	/** Undo is open from "I applied it" until the first check. */
	canUndo: z.boolean(),
});
export type FixOption = z.infer<typeof FixOptionSchema>;

export const FixesSchema = z.object({
	investigationId: z.string().uuid(),
	/** The run flagged text that tried to instruct it; show the note beside any command. Empty is not proof of safety. */
	flagged: z.boolean(),
	options: z.array(FixOptionSchema),
});
export type Fixes = z.infer<typeof FixesSchema>;

export const FixCheckSchema = z.object({
	stepId: z.string().uuid(),
	verdict: FixVerdictSchema,
	checkedAt: DateStringSchema,
	/** The one value judged, live only: never stored (ADR 0006 §1). */
	value: z.number().nullable(),
	threshold: ThresholdSchema.nullable(),
	reason: FixCheckReasonSchema.nullable(),
	/** What the strip says. */
	message: z.string(),
	/** Try again can help (timeout or a refused query). */
	retryable: z.boolean(),
});
export type FixCheck = z.infer<typeof FixCheckSchema>;
