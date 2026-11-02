// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Scheduled tasks (#979): work the host runs on a schedule. Every device reads; only the host writes.
 */
import { HARNESS_IDS } from "@prismalens/config/harness";
import { z } from "zod";
import { DateStringSchema } from "./common.js";

export const RecurrenceSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("cron"),
		expr: z.string().trim().min(9).max(120),
		/** IANA name; the host's own zone unless the operator picked another. */
		timezone: z.string().min(1).max(64),
	}),
	z.object({
		type: z.literal("interval"),
		everyMinutes: z.number().int().min(15).max(10_080),
		anchorAt: DateStringSchema,
	}),
]);
export type RecurrenceInput = z.infer<typeof RecurrenceSchema>;

/** Fixed: one minute and hour, so a repeated autumn hour runs once. Repeating: lists, ranges, steps. */
export const RecurrenceShapeSchema = z.enum(["fixed", "repeating", "interval"]);

export const MissedPolicySchema = z.enum(["run_once", "skip"]);
export type MissedPolicy = z.infer<typeof MissedPolicySchema>;

export const TICK_OUTCOMES = [
	"started",
	"late_started",
	"run_now",
	"skipped_overlap",
	"skipped_agent_not_ready",
	"skipped_bindings_changed",
	"missed_asleep",
	"missed_off",
	"missed_late",
	"expired_host_busy",
] as const;
export const TickOutcomeSchema = z.enum(TICK_OUTCOMES);
export type TickOutcome = z.infer<typeof TickOutcomeSchema>;

/** What became of the run a tick started, so the list can say "Nothing wrong found" or "Failed". */
export const TickRunSchema = z.object({
	id: z.string(),
	status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
	summary: z.string().nullable(),
	error: z.string().nullable(),
	startedAt: DateStringSchema.nullable(),
	completedAt: DateStringSchema.nullable(),
	incidentId: z.string().nullable(),
	incidentNumber: z.number().int().nullable(),
});

export const ScheduleTickSchema = z.object({
	id: z.string(),
	scheduledFor: DateStringSchema,
	decidedAt: DateStringSchema,
	outcome: TickOutcomeSchema,
	reason: z.string().nullable(),
	missedCount: z.number().int(),
	missedOverflow: z.boolean(),
	run: TickRunSchema.nullable(),
});
export type ScheduleTick = z.infer<typeof ScheduleTickSchema>;

export const ScheduleInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	serviceId: z.string().uuid(),
	runbook: z.string().trim().min(1).max(500).nullable(),
	brief: z.string().trim().min(1).max(4000),
	recurrence: RecurrenceSchema,
	harness: z.enum(HARNESS_IDS),
	model: z.string().min(1).max(200).nullable(),
	effort: z.string().min(1).max(64).nullable(),
	missedPolicy: MissedPolicySchema,
	catchUpMinutes: z.number().int().min(15).max(1440),
});
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>;

export const ScheduleSchema = ScheduleInputSchema.extend({
	id: z.string(),
	serviceName: z.string(),
	/** "Every weekday at 09:00", in the schedule's time zone. */
	description: z.string(),
	shape: RecurrenceShapeSchema,
	enabled: z.boolean(),
	pausedReason: z.string().nullable(),
	nextRunAt: DateStringSchema.nullable(),
	lastTick: ScheduleTickSchema.nullable(),
	/** The run still going, if any; a tick due meanwhile is skipped. */
	liveRunId: z.string().nullable(),
	revision: z.number().int(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});
export type Schedule = z.infer<typeof ScheduleSchema>;

/** Housekeeping PrismaLens runs itself; shown, never edited. */
export const BuiltInJobSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	cadence: z.string(),
	lastRunAt: DateStringSchema.nullable(),
	lastResult: z.string().nullable(),
	ok: z.boolean().nullable(),
	nextRunAt: DateStringSchema.nullable(),
});
export type BuiltInJob = z.infer<typeof BuiltInJobSchema>;

/** Every device reads the same list; `canEdit` is true only on the host (#979, #982). */
export const ScheduleAccessSchema = z.object({
	canEdit: z.boolean(),
	hostName: z.string(),
});

export const ScheduleListResponseSchema = ScheduleAccessSchema.extend({
	schedules: z.array(ScheduleSchema),
	builtIns: z.array(BuiltInJobSchema),
});

export const ScheduleDetailSchema = ScheduleAccessSchema.extend({
	schedule: ScheduleSchema,
	ticks: z.array(ScheduleTickSchema),
	nextCursor: z.string().nullable(),
});

export type ScheduleDetail = z.infer<typeof ScheduleDetailSchema>;

export const ScheduleDetailQuerySchema = z.object({
	id: z.string(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const SchedulePreviewInputSchema = z.object({
	recurrence: RecurrenceSchema,
});

export const SchedulePreviewSchema = z.object({
	description: z.string().nullable(),
	shape: RecurrenceShapeSchema.nullable(),
	next: z.array(DateStringSchema),
	/** Set when the next 30 days hold a clock change that moves or repeats a run. */
	dstNote: z.string().nullable(),
	error: z.string().nullable(),
});

export const ScheduleUpdateSchema = z.object({
	id: z.string(),
	/** The revision the editor read; a stale one is refused rather than overwriting. */
	revision: z.number().int(),
	schedule: ScheduleInputSchema,
});

export const ScheduleEnabledSchema = z.object({
	id: z.string(),
	enabled: z.boolean(),
});

export const ScheduleIdSchema = z.object({ id: z.string() });

/** Only the host's session may create, change or run a schedule (#979; the question is open in #982). */
export const SCHEDULE_HOST_ONLY =
	"Schedules are changed on the computer that runs PrismaLens.";
